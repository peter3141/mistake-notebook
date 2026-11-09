import { createClient } from './supabase/client'
import { sanitizeHtml } from './utils'
import type { Mistake, MistakeFilters, MistakeInput, MistakeImage, PrintTemplate, ShareLink, Subject, MistakeBook, Tag, MistakeVersion, ReviewResult } from '@/types'

export const db = () => createClient()

const BUCKET = 'mistake-images'

/** 私有桶图片 → 批量换取 1 小时签名 URL */
export async function signPaths(paths: string[]) {
  if (!paths.length) return new Map<string, string>()
  const { data } = await db().storage.from(BUCKET).createSignedUrls(paths, 3600)
  const map = new Map<string, string>()
  ;(data || []).forEach((d: any) => { if (d.signedUrl && d.path) map.set(d.path, d.signedUrl) })
  return map
}

/** 富文本里 <img data-storage-path="..."> → 注入当前签名 src（只改展示，不改数据库里的 HTML） */
export function hydrateRichText(html: string | null | undefined, urls: Map<string, string>): string {
  if (!html) return ''
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/data-storage-path="([^"]+)"/)
    if (!m) return tag
    const clean = tag.replace(/\ssrc\s*=\s*"[^"]*"/gi, '')
    const url = urls.get(m[1])
    if (!url) return `${clean.replace(/\s*\/?>$/, '')} alt="图片加载失败，请检查网络或存储配置">`
    return `${clean.replace(/\s*\/?>$/, '')} src="${url}">`
  })
}

/** 保存前把展示时临时注入的签名 src 去掉，只留持久化的 data-storage-path（避免把会过期的 URL 写进库） */
export function stripInjectedSrc(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.includes('data-storage-path=') ? tag.replace(/\ssrc\s*=\s*"[^"]*"/gi, '') : tag)
}

/** 把联表结果压平 + 补签名 URL（★ 图片表与富文本内嵌图统一走 Storage URL） */
export async function hydrate(rows: any[]): Promise<Mistake[]> {
  const paths = rows.flatMap((r) => [
    ...(r.images || []).map((i: any) => i.storage_path as string),
    ...(r.images || []).map((i: any) => i.thumbnail_path as string).filter(Boolean),
    ...(['content', 'answer', 'analysis'] as const).flatMap((k) =>
      [...String(r[k] || '').matchAll(/data-storage-path="([^"]+)"/g)].map((m) => m[1]))
  ])
  const urls = await signPaths([...new Set(paths.filter(Boolean))])
  return rows.map((r) => ({
    ...r,
    content: hydrateRichText(r.content, urls),
    answer: hydrateRichText(r.answer, urls),
    analysis: hydrateRichText(r.analysis, urls),
    tags: (r.tags || []).map((t: any) => t.tag).filter(Boolean) as Tag[],
    images: (r.images || []).map((i: any) => ({
      ...i,
      signedUrl: urls.get(i.storage_path) || '',
      thumbnailUrl: i.thumbnail_path ? urls.get(i.thumbnail_path) || '' : ''
    })) as MistakeImage[]
  })) as Mistake[]
}

const SELECT = '*, subject:subjects(id,name,color), book:mistake_books(id,name), images:mistake_images(*), tags:mistake_tags(tag:tags(id,name,color))'

export async function listMistakes(f: MistakeFilters = {}) {
  const page = f.page || 1, pageSize = f.pageSize || 20
  let q = db().from('mistakes').select(SELECT, { count: 'exact' })
  q = f.includeDeleted ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
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
    // 先查关联表拿到错题 id，再 in 过滤，避免嵌入表过滤导致联表结果被截断
    const { data: mt } = await db().from('mistake_tags').select('mistake_id').eq('tag_id', f.tag_id)
    const ids = (mt || []).map((x: any) => x.mistake_id)
    q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  }
  if (f.dateFrom) {
    const col = f.dateBy === 'created_at' ? 'created_at' : f.dateBy === 'next_review_at' ? 'next_review_at' : 'mistake_date'
    q = q.gte(col, f.dateBy === 'mistake_date' || !f.dateBy ? f.dateFrom : `${f.dateFrom}T00:00:00`)
  }
  if (f.dateTo) {
    const col = f.dateBy === 'created_at' ? 'created_at' : f.dateBy === 'next_review_at' ? 'next_review_at' : 'mistake_date'
    q = q.lte(col, f.dateBy === 'mistake_date' || !f.dateBy ? f.dateTo : `${f.dateTo}T23:59:59`)
  }
  switch (f.sort) {
    case 'oldest': q = q.order('created_at', { ascending: true }); break
    case 'review': q = q.order('next_review_at', { ascending: true }); break
    case 'errors': q = q.order('error_count', { ascending: false }); break
    default: q = q.order('created_at', { ascending: false })
  }
  const { data, count, error } = await q.range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  return { rows: await hydrate(data || []), count: count || 0 }
}

export async function getMistake(id: string) {
  const { data, error } = await db().from('mistakes').select(SELECT).eq('id', id).single()
  if (error) throw error
  return (await hydrate([data]))[0]
}

/** 保存错题：清洗富文本；触发器会自动写一份「修改前」历史版本 */
export async function upsertMistake(input: MistakeInput, id?: string) {
  const user = (await db().auth.getUser()).data.user
  if (!user) throw new Error('请先登录')
  const payload: any = {
    ...input,
    content: sanitizeHtml(stripInjectedSrc(input.content || '')),
    answer: sanitizeHtml(stripInjectedSrc(input.answer || '')),
    analysis: sanitizeHtml(stripInjectedSrc(input.analysis || '')),
    user_id: user.id
  }
  delete payload.images; delete payload.tags; delete payload.subject; delete payload.book
  delete payload.created_at; delete payload.updated_at
  const { data, error } = id
    ? await db().from('mistakes').update(payload).eq('id', id).eq('user_id', user.id).select('id').single()
    : await db().from('mistakes').insert(payload).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function setMistakeTags(mistakeId: string, names: string[]) {
  const supabase = db()
  const user = (await supabase.auth.getUser()).data.user!
  await supabase.from('mistake_tags').delete().eq('mistake_id', mistakeId)
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 20)
  for (const name of clean) {
    const { data: tag } = await supabase.from('tags').upsert({ user_id: user.id, name }, { onConflict: 'user_id,name' }).select('id').single()
    if (tag) await supabase.from('mistake_tags').insert({ user_id: user.id, mistake_id: mistakeId, tag_id: tag.id })
  }
}

/** 压缩后的普通插图上传到 Storage；上传成功后才写库（失败不产生空记录） */
export async function uploadMistakeImage(mistakeId: string, file: File, sortOrder = 0) {
  const supabase = db()
  const user = (await supabase.auth.getUser()).data.user!
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  const path = `${user.id}/mistakes/inline/${mistakeId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  const { data, error: e2 } = await supabase.from('mistake_images').insert({
    user_id: user.id, mistake_id: mistakeId, storage_path: path, mime_type: file.type,
    size_bytes: file.size, compressed_size_bytes: file.size, image_role: 'inline', sort_order: sortOrder
  }).select('*').single()
  if (e2) {
    await supabase.storage.from(BUCKET).remove([path])
    throw e2
  }
  return data as MistakeImage
}

/** 新建错题页先上传的整题图（draft_id）绑定到真正错题 id */
export async function bindDraftImages(draftId: string, mistakeId: string) {
  if (!draftId || !mistakeId) return 0
  const { data, error } = await db().from('mistake_images')
    .update({ mistake_id: mistakeId, draft_id: null })
    .eq('draft_id', draftId).select('id')
  if (error) throw error
  return data?.length || 0
}

/** 删除单张图片：登记进图片回收站，Storage 文件【不立即物理删除】 */
export async function deleteMistakeImage(id: string) {
  const supabase = db()
  const { data: row } = await supabase.from('mistake_images').select('*').eq('id', id).single()
  if (!row) return
  const payload = {
    user_id: row.user_id, source_table: 'mistake_images', source_id: row.id,
    mistake_id: row.mistake_id, storage_path: row.storage_path,
    image_role: row.image_role || 'inline', parent_image_id: row.parent_image_id,
    meta: { mime_type: row.mime_type, size_bytes: row.size_bytes, width: row.width, height: row.height }
  }
  const { data: existing } = await supabase.from('deleted_images').select('id')
    .eq('user_id', row.user_id).eq('storage_path', row.storage_path).is('purged_at', null).maybeSingle()
  if (existing) await supabase.from('deleted_images').update(payload).eq('id', existing.id)
  else await supabase.from('deleted_images').insert(payload)
  const { error } = await supabase.from('mistake_images').delete().eq('id', id)
  if (error) throw error
}

/** 该整图有没有裁剪图引用（删除原图前用于提示） */
export async function countCroppedChildren(imageId: string) {
  const { count } = await db().from('mistake_images').select('id', { count: 'exact', head: true })
    .eq('parent_image_id', imageId).eq('image_role', 'cropped')
  return count || 0
}

/** 图片回收站：列出 / 恢复 / 彻底删除（只有彻底删除才删 Storage 文件） */
export async function listDeletedImages() {
  const { data } = await db().from('deleted_images').select('*')
    .is('purged_at', null).order('deleted_at', { ascending: false }).limit(200)
  return data || []
}

export async function restoreDeletedImage(id: string) {
  const supabase = db()
  const { data: d } = await supabase.from('deleted_images').select('*').eq('id', id).maybeSingle()
  if (!d) throw new Error('图片回收站记录不存在')
  if (d.mistake_id) {
    const { data: alive } = await supabase.from('mistakes').select('id').eq('id', d.mistake_id).maybeSingle()
    if (!alive) throw new Error('原错题已被彻底删除，无法恢复该图片，请重新上传')
  }
  await supabase.from('mistake_images').insert({
    user_id: d.user_id, mistake_id: d.mistake_id,
    draft_id: d.mistake_id ? null : crypto.randomUUID(),
    storage_path: d.storage_path,
    mime_type: d.meta?.mime_type || 'image/webp', size_bytes: d.meta?.size_bytes || null,
    width: d.meta?.width || null, height: d.meta?.height || null,
    image_role: d.image_role || 'inline', parent_image_id: d.parent_image_id || null
  })
  await supabase.from('deleted_images').update({ purged_at: new Date().toISOString() }).eq('id', id)
}

/** 彻底删除：先删 Storage 文件，成功才标 purged_at；失败留下可查记录 */
export async function purgeDeletedImage(id: string) {
  const supabase = db()
  const { data: d } = await supabase.from('deleted_images').select('*').eq('id', id).maybeSingle()
  if (!d) return
  const { error } = await supabase.storage.from(BUCKET).remove([d.storage_path])
  if (error) {
    await supabase.from('image_purge_failures').insert({
      user_id: d.user_id, deleted_image_id: id, storage_path: d.storage_path, error: error.message
    })
    throw new Error(`删除 Storage 文件失败：${error.message}（已登记失败记录，数据库记录仍在，可重试）`)
  }
  await supabase.from('deleted_images').update({ purged_at: new Date().toISOString() }).eq('id', id)
}

/** 彻底删除错题时，把它名下的 Storage 图片一起删掉（与图片回收站记录保持一致） */
export async function removeStorageFilesForMistake(mistakeId: string) {
  const supabase = db()
  const { data: live } = await supabase.from('mistake_images').select('storage_path,thumbnail_path').eq('mistake_id', mistakeId)
  const { data: trashed } = await supabase.from('deleted_images').select('storage_path').eq('mistake_id', mistakeId).is('purged_at', null)
  const paths = [...new Set([
    ...(live || []).flatMap((i: any) => [i.storage_path, i.thumbnail_path].filter(Boolean)),
    ...(trashed || []).map((i: any) => i.storage_path)
  ])]
  if (paths.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) {
      const user = (await supabase.auth.getUser()).data.user
      if (user) for (const p of paths) await supabase.from('image_purge_failures').insert({
        user_id: user.id, storage_path: p, error: error.message
      })
      throw new Error(`删除 Storage 图片失败：${error.message}（已登记失败记录，可重试）`)
    }
  }
  await supabase.from('deleted_images').update({ purged_at: new Date().toISOString() })
    .eq('mistake_id', mistakeId).is('purged_at', null)
}

export async function softDeleteMistake(id: string) {
  const { error } = await db().from('mistakes').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
export async function restoreMistake(id: string) {
  const { error } = await db().from('mistakes').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}
export async function hardDeleteMistake(id: string) {
  const supabase = db()
  await removeStorageFilesForMistake(id)
  const { error } = await supabase.from('mistakes').delete().eq('id', id)
  if (error) throw error
}
export async function clearTrash() {
  const supabase = db()
  const { data } = await supabase.from('mistakes').select('id').not('deleted_at', 'is', null)
  for (const m of data || []) await hardDeleteMistake(m.id)
  return data?.length || 0
}

export const listSubjects = async () => (await db().from('subjects').select('*').eq('archived', false).order('sort_order')).data as Subject[] || []
export const listBooks = async () => (await db().from('mistake_books').select('*').eq('archived', false).order('created_at')).data as MistakeBook[] || []
export const listTags = async () => (await db().from('tags').select('*').order('name')).data as Tag[] || []

export async function quickCreate(kind: 'subjects' | 'mistake_books' | 'tags', name: string) {
  const user = (await db().auth.getUser()).data.user!
  const { data, error } = await db().from(kind).insert({ user_id: user.id, name }).select('*').single()
  if (error) throw error
  return data
}

/** 仪表盘统计（首页） */
export async function dashboardStats() {
  const supabase = db()
  const now = new Date(), weekStart = new Date(now); weekStart.setDate(now.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const { data: all } = await supabase.from('mistakes')
    .select('id, subject_id, subject:subjects(id,name), mastery, cause, knowledge_points, mistake_date, created_at, next_review_at, deleted_at')
    .is('deleted_at', null)
  const rows = all || []
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  return {
    total: rows.length,
    dueToday: rows.filter((r) => new Date(r.next_review_at) <= todayEnd).length,
    weekNew: rows.filter((r) => new Date(r.created_at) >= weekStart).length,
    monthNew: rows.filter((r) => new Date(r.created_at) >= monthStart).length,
    rows
  }
}

export async function reviewQueue(limit = 50) {
  const { data, error } = await db().from('mistakes').select(SELECT)
    .is('deleted_at', null).lte('next_review_at', new Date(Date.now() + 86400000).toISOString())
    .order('next_review_at').limit(limit)
  if (error) throw error
  return hydrate(data || [])
}

export async function markReview(mistakeId: string, result: ReviewResult, note: string, intervals: number[], currentInterval: number) {
  const supabase = db()
  const user = (await supabase.auth.getUser()).data.user!
  const days = (() => {
    const s = [...intervals].sort((a, b) => a - b)
    if (result === 'again') return s[0] || 1
    if (result === 'fuzzy') return currentInterval || s[0] || 1
    const i = s.findIndex((n) => n > currentInterval)
    return i === -1 ? (s[s.length - 1] || 30) * 2 : s[i]
  })()
  const next = new Date(); next.setDate(next.getDate() + days)
  await supabase.from('review_logs').insert({
    user_id: user.id, mistake_id: mistakeId, result, note, next_review_at: next.toISOString()
  })
  const { data: m } = await supabase.from('mistakes').select('error_count, review_count').eq('id', mistakeId).single()
  await supabase.from('mistakes').update({
    mastery: result === 'mastered' ? 'mastered' : result === 'fuzzy' ? 'fuzzy' : 'unmastered',
    next_review_at: next.toISOString(), review_interval_days: days,
    review_count: (m?.review_count || 0) + 1,
    error_count: (m?.error_count || 0) + (result === 'again' ? 1 : 0)
  }).eq('id', mistakeId)
  return { days, next }
}

export async function listVersions(mistakeId: string) {
  const { data } = await db().from('mistake_versions').select('*').eq('mistake_id', mistakeId).order('version_no', { ascending: false })
  return (data || []) as MistakeVersion[]
}

export async function rollbackVersion(mistakeId: string, v: MistakeVersion) {
  const s: any = v.snapshot
  await upsertMistake({
    title: s.title, content: s.content, answer: s.answer, analysis: s.analysis,
    knowledge_points: s.knowledge_points, cause: s.cause, difficulty: s.difficulty,
    source: s.source, mastery: s.mastery, mistake_date: s.mistake_date
  }, mistakeId)
}

export const listPrintTemplates = async () => (await db().from('print_templates').select('*').order('created_at')).data as PrintTemplate[] || []
export async function savePrintTemplate(t: Omit<PrintTemplate, 'id' | 'user_id' | 'created_at'>) {
  const user = (await db().auth.getUser()).data.user!
  const { error } = await db().from('print_templates').upsert({ user_id: user.id, ...t }, { onConflict: 'user_id,name' })
  if (error) throw error
}
export async function deletePrintTemplate(id: string) { await db().from('print_templates').delete().eq('id', id) }

export async function listShares() {
  return (await db().from('share_links').select('*').order('created_at', { ascending: false })).data as ShareLink[] || []
}
export async function revokeShare(id: string) { await db().from('share_links').update({ revoked: true }).eq('id', id) }
