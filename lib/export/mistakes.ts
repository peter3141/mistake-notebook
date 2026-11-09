/**
 * 导出专用数据层（只在服务端 API 路由里被调用）。
 *
 * 安全性：
 *  - 传入的 supabase 是「带当前登录用户 cookie」的客户端 → Postgres RLS 自动生效；
 *  - 另外显式 .eq('user_id', user.id) 双保险，防止将来误改成 service_role 泄漏他人数据；
 *  - 私有桶图片必须走 storage.download（同样受 Storage RLS 约束），只下载属于当前用户的路径。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MistakeFilters } from '@/types'
import { imageExt } from './html'
import { normalizeImage } from './image'

export const BUCKET = 'mistake-images'
export const MAX_ROWS = 300          // 单次导出最多 300 道，超出会提示分批
export const MAX_IMAGES = 40         // 单次最多内嵌 40 张图
export const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024  // 单次最多 6MB 图片，避免函数响应过大

export interface ExportImage {
  fileName: string
  base64: string
  mime: 'image/png' | 'image/jpeg'
  ext: 'png' | 'jpg'
  width: number
  height: number
  bytes: number
}

export interface ExportMistake {
  id: string
  title: string
  content: string
  answer: string
  analysis: string
  cause: string | null
  difficulty: number | null
  mastery: string | null
  source: string | null
  mistake_date: string | null
  knowledge_points: string[] | null
  subjectName: string
  bookName: string
  tags: string[]
  images: Array<{ storage_path: string; mime_type: string | null; sort_order: number | null }>
  /** 下载成功并内嵌的图片（文件名与 ExportImage 对应） */
  embedded: ExportImage[]
}

export interface ExportQuery {
  ids?: string[]
  filter?: MistakeFilters
}

const SELECT = '*, subject:subjects(id,name,color), book:mistake_books(id,name), images:mistake_images(*), tags:mistake_tags(tag:tags(id,name,color))'

/** 按 ids 或当前筛选条件查询当前用户自己的错题（不含回收站） */
export async function loadMistakesForExport(
  supabase: SupabaseClient, userId: string, body: ExportQuery
): Promise<{ rows: ExportMistake[]; truncated: boolean }> {
  let q = supabase.from('mistakes').select(SELECT)
    .is('deleted_at', null)
    .eq('user_id', userId)

  if (body.ids?.length) {
    const ids = [...new Set(body.ids.filter((x) => typeof x === 'string'))].slice(0, MAX_ROWS)
    if (!ids.length) throw new Error('没有可导出的错题')
    q = q.in('id', ids)
  } else if (body.filter) {
    const f = body.filter
    if (f.q) {
      const s = f.q.replace(/[(),.%'"\\]/g, ' ').trim().slice(0, 80)
      if (s) q = q.or(`title.ilike.%${s}%,content.ilike.%${s}%,answer.ilike.%${s}%,analysis.ilike.%${s}%,source.ilike.%${s}%`)
    }
    if (f.subject_id) q = q.eq('subject_id', f.subject_id)
    if (f.book_id) q = q.eq('book_id', f.book_id)
    if (f.cause) q = q.eq('cause', f.cause)
    if (f.difficulty) q = q.eq('difficulty', f.difficulty)
    if (f.mastery) q = q.eq('mastery', f.mastery)
    if (f.tag_id) {
      const { data: mt } = await supabase.from('mistake_tags').select('mistake_id')
        .eq('user_id', userId).eq('tag_id', f.tag_id)
      const ids = (mt || []).map((x: any) => x.mistake_id)
      q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    }
    if (f.dateFrom || f.dateTo) {
      const col = f.dateBy === 'created_at' ? 'created_at' : f.dateBy === 'next_review_at' ? 'next_review_at' : 'mistake_date'
      if (f.dateFrom) q = q.gte(col, col === 'mistake_date' ? f.dateFrom : `${f.dateFrom}T00:00:00`)
      if (f.dateTo) q = q.lte(col, col === 'mistake_date' ? f.dateTo : `${f.dateTo}T23:59:59`)
    }
    switch (f.sort) {
      case 'oldest': q = q.order('created_at', { ascending: true }); break
      case 'review': q = q.order('next_review_at', { ascending: true }); break
      case 'errors': q = q.order('error_count', { ascending: false }); break
      default: q = q.order('created_at', { ascending: false })
    }
  } else {
    throw new Error('请提供 ids 或筛选条件')
  }

  const { data, error } = await q.limit(MAX_ROWS + 1)
  if (error) throw new Error('读取错题失败：' + error.message)

  const truncated = (data || []).length > MAX_ROWS
  const rows: ExportMistake[] = (data || []).slice(0, MAX_ROWS).map((r: any) => ({
    id: r.id,
    title: r.title || '（无标题）',
    content: r.content || '',
    answer: r.answer || '',
    analysis: r.analysis || '',
    cause: r.cause || null,
    difficulty: r.difficulty ?? null,
    mastery: r.mastery || null,
    source: r.source || null,
    mistake_date: r.mistake_date || null,
    knowledge_points: Array.isArray(r.knowledge_points) ? r.knowledge_points : [],
    subjectName: r.subject?.name || '未分类',
    bookName: r.book?.name || '默认错题本',
    tags: (r.tags || []).map((t: any) => t.tag?.name).filter(Boolean),
    images: (r.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)),
    embedded: []
  }))
  return { rows, truncated }
}

/**
 * 从私有桶下载图片并转成 base64（Word 内嵌 / Anki media 文件共用）。
 * 单张失败会跳过并记录 warning，不阻塞整份导出；原图仍保留在云端。
 */
export async function embedImages(
  supabase: SupabaseClient, userId: string, rows: ExportMistake[],
  onProgress?: (done: number, total: number) => void
): Promise<{ warnings: string[]; skipped: number }> {
  const all = rows.flatMap((r) => r.images.map((i) => ({ row: r, path: i.storage_path, mime: i.mime_type || 'image/jpeg' })))
  const picked = all.filter((x) => x.path && x.path.startsWith(`${userId}/`)).slice(0, MAX_IMAGES)
  const skipped = all.length - picked.length
  const warnings: string[] = []
  if (skipped > 0) warnings.push(`图片数量超过单次上限 ${MAX_IMAGES} 张，已跳过 ${skipped} 张；请缩小范围分批导出。`)

  let totalBytes = 0, done = 0
  for (const item of picked) {
    done++
    onProgress?.(done, picked.length)
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(item.path)
      if (error || !data) throw new Error(error?.message || '空文件')
      const raw = Buffer.from(await data.arrayBuffer())
      if (raw.byteLength > 2 * 1024 * 1024) { warnings.push(`已跳过超大图片 ${item.path.split('/').pop()}`); continue }
      const norm = await normalizeImage(raw, imageExt(item.path, item.mime))
      if (norm.unsupported) {
        warnings.push(`图片 ${item.path.split('/').pop()} 是 WebP，服务端缺少图片转换组件，未内嵌；安装 sharp 后重新部署即可。`)
        continue
      }
      if (totalBytes + norm.buf.byteLength > MAX_TOTAL_IMAGE_BYTES) {
        warnings.push('图片总体积已达到 6MB 上限，其余图片未内嵌；可缩小范围分批导出。')
        break
      }
      totalBytes += norm.buf.byteLength
      const fileName = `m_${item.row.id.slice(0, 8)}_${item.row.embedded.length + 1}.${norm.ext}`
      item.row.embedded.push({
        fileName, base64: norm.buf.toString('base64'), mime: norm.mime, ext: norm.ext,
        width: norm.width, height: norm.height, bytes: norm.buf.byteLength
      })
    } catch (e: any) {
      warnings.push(`图片 ${item.path.split('/').pop()} 读取失败，已跳过：${e?.message || '未知错误'}`)
    }
  }
  return { warnings, skipped }
}
