import { z } from 'zod'
import JSZip from 'jszip'
import { createClient } from '@/lib/supabase/server'
import { ndjsonResponse } from '@/lib/export/stream'
import { BUCKET } from '@/lib/images/server'
import { toDateInput } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const Body = z.object({
  ids: z.array(z.string().uuid()).max(300).optional(),
  dateFrom: z.string().max(20).optional(),
  dateTo: z.string().max(20).optional(),
  bookId: z.string().uuid().optional(),
  imageRoles: z.array(z.enum(['original', 'cropped', 'inline', 'thumbnail'])).max(4).optional()
})

const MAX_IMAGES = 500
const MAX_TOTAL_BYTES = 60 * 1024 * 1024
const ROLE_LABEL: Record<string, string> = {
  original: '整题原图', cropped: '手动裁剪图', inline: '富文本内嵌图', thumbnail: '缩略图'
}

function safeName(s: string) {
  return (s || '未命名').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40)
}

/**
 * 导出原图包（本地离线备份，可选辅助功能）
 *  - 只从当前用户自己的错题 + 私有桶下载（RLS + 显式 user_id 双保险）
 *  - 图片本体打包进 zip，网页不依赖本地文件；换电脑/重装系统网页仍从 Storage 取图
 *  - 包内 清单.txt 逐张说明「文件名 → 哪道错题 → 图片用途」
 *  - NDJSON 进度 + 失败提示；不自动同步、不读用户本地文件夹
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: '参数不合法' }, { status: 400 })
  const body = parsed.data

  return ndjsonResponse(async (emit) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { emit({ type: 'error', error: '请先登录后再导出' }); return }

    let q = supabase.from('mistakes')
      .select('id,title,mistake_date,images:mistake_images(id,storage_path,mime_type,image_role,parent_image_id,size_bytes)')
      .eq('user_id', user.id).is('deleted_at', null)
      .order('mistake_date', { ascending: false }).limit(300)
    if (body.ids?.length) q = q.in('id', body.ids)
    if (body.bookId) q = q.eq('book_id', body.bookId)
    if (body.dateFrom) q = q.gte('mistake_date', body.dateFrom)
    if (body.dateTo) q = q.lte('mistake_date', body.dateTo)
    const { data: rows, error } = await q
    if (error) { emit({ type: 'error', error: error.message }); return }

    const roles = body.imageRoles?.length ? body.imageRoles : ['original', 'cropped', 'inline', 'thumbnail']
    const files: Array<{ row: any; img: any }> = (rows || []).flatMap((r: any) =>
      (r.images || []).filter((i: any) => roles.includes(i.image_role || 'inline')).map((img: any) => ({ row: r, img })))
    if (!files.length) { emit({ type: 'error', error: '所选范围内没有可导出的图片' }); return }
    const truncated = files.length > MAX_IMAGES
    const list = files.slice(0, MAX_IMAGES)

    emit({ type: 'progress', stage: '正在从云端 Storage 下载图片', done: 0, total: list.length })
    const zip = new JSZip()
    const folder = zip.folder('images')!
    const manifest: string[] = [
      '个人综合管理网站 · 原图离线备份包',
      `导出时间：${new Date().toISOString()}`,
      `错题数：${new Set(list.map((f) => f.row.id)).size} ；图片数：${list.length}`,
      '',
      '【这是离线副本】网页展示、打印、分享、AI OCR 一律从云端 Supabase Storage 取图，',
      '不依赖本机文件。换电脑、重装系统、关机都不会影响网站里的图片。',
      '',
      '文件名 | 错题标题 | 错题日期 | 图片用途 | 来源 | Storage 路径'
    ]
    const warnings: string[] = []
    let totalBytes = 0, done = 0

    for (const { row, img } of list) {
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(img.storage_path)
      done++
      if (dlErr || !blob) {
        warnings.push(`下载失败：${img.storage_path}（${dlErr?.message || '空文件'}），原图仍在云端未受影响`)
      } else {
        const buf = Buffer.from(await blob.arrayBuffer())
        if (totalBytes + buf.byteLength > MAX_TOTAL_BYTES) {
          warnings.push('已达到 60MB 单次上限，其余图片未打包；请缩小时间范围分批导出。')
          break
        }
        totalBytes += buf.byteLength
        const ext = (img.storage_path.split('.').pop() || 'webp').toLowerCase()
        const name = `${safeName(row.title)}-${ROLE_LABEL[img.image_role] || '图片'}-${img.id.slice(0, 8)}.${ext}`
        folder.file(name, buf)
        manifest.push(`${name} | ${row.title} | ${row.mistake_date || ''} | ${ROLE_LABEL[img.image_role] || '图片'} | ${img.image_role === 'original' ? '整题原图' : '压缩图'} | ${img.storage_path}`)
      }
      if (done % 5 === 0 || done === list.length) emit({ type: 'progress', stage: '正在打包图片', done, total: list.length })
    }

    zip.file('清单.txt', '\uFEFF' + manifest.join('\r\n'))
    zip.file('说明.txt', '\uFEFF' + [
      '这是什么？',
      '这是你手动下载的「图片离线副本」，仅用于本地留档。网站本身不会读取这个文件夹，',
      '也不会自动同步；网页任何功能都不要求你的电脑常开。',
      '',
      '图片存哪里？',
      '网站的唯一图片来源是 Supabase Storage 私有桶 mistake-images。数据库只存路径和元数据，',
      '没有图片二进制、没有 Base64、没有 Blob。',
      '',
      '换电脑 / 重装系统会丢图吗？',
      '不会。只要 Supabase 项目还在，登录同一账号就能看到全部图片。',
      '',
      '想恢复这张本地图到网站？',
      '不需要「恢复」—— 网站里本来就有。若云端图片被彻底删除，可打开对应错题，',
      '用「拍照/上传整题」或「插入图片」重新上传这张本地文件即可。',
      '',
      '裁剪图说明',
      '标注「手动裁剪图」的文件是从整题原图手动框选出来的，原整图始终单独保留。',
      '',
      ...(warnings.length ? ['本次导出提示：', ...warnings.map((w) => '- ' + w)] : [])
    ].join('\r\n'))

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
    emit({
      type: 'file', name: `原图包-${toDateInput(new Date())}.zip`, mime: 'application/zip',
      base64: buffer.toString('base64'),
      warnings: [...warnings, ...(truncated ? [`图片超过 ${MAX_IMAGES} 张，仅导出前 ${MAX_IMAGES} 张，请分批`] : [])]
    })
  })
}
