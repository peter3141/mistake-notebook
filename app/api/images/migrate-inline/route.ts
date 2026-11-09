import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { BUCKET } from '@/lib/images/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  mistakeId: z.string().uuid(),
  fields: z.object({
    content: z.string().max(400000).optional(),
    answer: z.string().max(400000).optional(),
    analysis: z.string().max(400000).optional()
  })
})

const FIELDS = ['content', 'answer', 'analysis'] as const
const MAX_EACH = 6 * 1024 * 1024

/**
 * 把历史富文本里的 Base64 图片迁到 Storage（v4 迁移入口）
 *  - 幂等：已迁移过（HTML 里没有 data:image）再次执行会返回 0，不重复上传
 *  - 只处理当前用户自己的错题；写库用带登录态 client，RLS 生效
 *  - 迁移后 HTML 只保留 data-storage-path，展示时由服务端现签 Storage URL
 *  - 迁移失败的字段原样保留并在 warnings 里列清单，供手动处理
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 })
  const { mistakeId, fields } = parsed.data

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const { data: own } = await supabase.from('mistakes').select('id').eq('id', mistakeId).eq('user_id', user.id).maybeSingle()
  if (!own) return NextResponse.json({ error: '错题不存在或无权访问' }, { status: 403 })

  const out: Record<string, string> = {}
  const warnings: string[] = []
  let migrated = 0
  const uploaded: string[] = []

  for (const field of FIELDS) {
    let html = fields[field] || ''
    if (!html) { out[field] = ''; continue }
    const tags = html.match(/<img\b[^>]*>/gi) || []
    let changed = false

    for (const tag of tags) {
      const m = tag.match(/src\s*=\s*["']data:image\/([a-zA-Z0-9.+-]+);base64,([^"']+)["']/i)
      if (!m) continue
      const extRaw = m[1].toLowerCase().replace('jpeg', 'jpg')
      const ext = ['png', 'jpg', 'webp', 'gif'].includes(extRaw) ? extRaw : 'webp'
      let buf: Buffer
      try { buf = Buffer.from(m[2], 'base64') } catch { warnings.push(`${field}：一张图片 Base64 解码失败，已保留原文`); continue }
      if (!buf.byteLength || buf.byteLength > MAX_EACH) {
        warnings.push(`${field}：一张图片为空或超过 6MB，已保留原文，请手动重新上传`)
        continue
      }
      const path = `${user.id}/mistakes/inline/${mistakeId}/${crypto.randomUUID()}.${ext}`
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false })
      if (upErr) { warnings.push(`${field}：上传失败 ${upErr.message}，原 Base64 已保留`); continue }

      const { error: dbErr } = await supabase.from('mistake_images').insert({
        user_id: user.id, mistake_id: mistakeId, storage_path: path,
        mime_type: mime, size_bytes: buf.byteLength, compressed_size_bytes: buf.byteLength,
        image_role: 'inline', created_by: 'migration', sort_order: 99
      })
      if (dbErr) {
        await supabase.storage.from(BUCKET).remove([path])
        warnings.push(`${field}：登记失败 ${dbErr.message}，已回滚文件`)
        continue
      }
      uploaded.push(path)
      // 只保留 data-storage-path，绝不再把图片数据写回 HTML
      const alt = (tag.match(/alt\s*=\s*"([^"]*)"/) || [])[1] || '迁移图片'
      html = html.replace(tag, `<img data-storage-path="${path}" alt="${alt.replace(/"/g, '')}">`)
      migrated++; changed = true
    }
    out[field] = html
    if (changed) {
      const { error } = await supabase.from('mistakes').update({ [field]: html }).eq('id', mistakeId).eq('user_id', user.id)
      if (error) warnings.push(`${field}：写回题库失败 ${error.message}（图片已在云端，路径见清单）`)
    }
  }

  return NextResponse.json({
    migrated, fields: out, warnings, uploadedPaths: uploaded,
    message: migrated
      ? `已迁移 ${migrated} 张图片到云端 Storage，富文本里不再有 Base64`
      : '没有发现需要迁移的 Base64 图片（脚本可重复执行）'
  })
}
