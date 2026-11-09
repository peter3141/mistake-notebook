import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * 公开只读分享：唯一使用 service_role 的地方。
 * 严格校验 token / 过期 / 撤销，并只 SELECT 白名单字段（隐藏 user_id、ai_result、source、复习备注等隐私字段）。
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient()
  const { data: link, error } = await admin.from('share_links').select('*').eq('token', params.token).maybeSingle()
  if (error || !link) return NextResponse.json({ error: '分享链接不存在' }, { status: 404 })
  if (link.revoked) return NextResponse.json({ error: '该分享已被取消' }, { status: 410 })
  if (new Date(link.expires_at) < new Date()) return NextResponse.json({ error: '分享链接已过期' }, { status: 410 })
  // ★ v4：图片签名 URL 的有效期不超过分享链接剩余时间，链接过期后图片也不可访问
  const ttl = Math.max(60, Math.min(3600, Math.floor((new Date(link.expires_at).getTime() - Date.now()) / 1000)))

  // v2：笔记只读分享。只 SELECT 白名单字段，user_id / mistake_id / schedule_id 等隐私字段一律不返回
  if (link.scope === 'note' && link.target_id) {
    const { data: note } = await admin.from('notes')
      .select('id,title,content,tags,summary,created_at')
      .eq('id', link.target_id).eq('user_id', link.user_id).is('deleted_at', null).maybeSingle()
    if (!note) return NextResponse.json({ error: '笔记不存在或已被删除' }, { status: 404 })
    const paths = [...String(note.content || '').matchAll(/data-storage-path="([^"]+)"/g)].map((m) => m[1])
    let html = String(note.content || '')
    if (paths.length) {
      const { data: signed } = await admin.storage.from('mistake-images').createSignedUrls([...new Set(paths)], ttl)
      const map = new Map((signed || []).map((s: any) => [s.path, s.signedUrl]))
      html = html.replace(/data-storage-path="([^"]+)"/g, (_all: string, p: string) => `src="${map.get(p) || ''}"`)
    }
    await admin.from('share_links').update({ view_count: (link.view_count || 0) + 1 }).eq('id', link.id)
    return NextResponse.json({
      title: note.title, expiresAt: link.expires_at, count: 1, kind: 'note',
      notes: [{ id: note.id, title: note.title, content: html, tags: note.tags || [], summary: note.summary || '' }],
      mistakes: []
    })
  }

  // v2：日程只读分享
  if (link.scope === 'schedule' && link.target_id) {
    const { data: s } = await admin.from('schedules')
      .select('id,title,start_at,end_at,all_day,location,category,priority,description')
      .eq('id', link.target_id).eq('user_id', link.user_id).is('deleted_at', null).maybeSingle()
    if (!s) return NextResponse.json({ error: '日程不存在或已被删除' }, { status: 404 })
    await admin.from('share_links').update({ view_count: (link.view_count || 0) + 1 }).eq('id', link.id)
    return NextResponse.json({
      title: s.title, expiresAt: link.expires_at, count: 1, kind: 'schedule',
      schedules: [s], mistakes: []
    })
  }

  let q = admin.from('mistakes')
    .select('id,title,content,answer,analysis,knowledge_points,cause,difficulty,mistake_date,subject:subjects(name),images:mistake_images(storage_path)')
    .eq('user_id', link.user_id).is('deleted_at', null).order('mistake_date', { ascending: false }).limit(200)

  if (link.scope === 'single' && link.target_id) q = q.eq('id', link.target_id)
  if (link.scope === 'book' && link.target_id) q = q.eq('book_id', link.target_id)
  if (link.scope === 'filter') {
    const f = (link.filter_json || {}) as any
    if (f.subject_id) q = q.eq('subject_id', f.subject_id)
    if (f.cause) q = q.eq('cause', f.cause)
    if (f.mastery) q = q.eq('mastery', f.mastery)
    if (f.dateFrom) q = q.gte('mistake_date', f.dateFrom)
    if (f.dateTo) q = q.lte('mistake_date', f.dateTo)
  }
  const { data: rows } = await q

  // 私有桶图片换成签名 URL；分享页隐藏所有隐私字段
  // v4：同时覆盖富文本里 data-storage-path 的内嵌图，全部走 Storage URL
  const paths = (rows || []).flatMap((r: any) => [
    ...(r.images || []).map((i: any) => i.storage_path as string),
    ...(['content', 'answer', 'analysis'] as const).flatMap((k) =>
      [...String(r[k] || '').matchAll(/data-storage-path="([^"]+)"/g)].map((m) => m[1]))
  ])
  let urlMap = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await admin.storage.from('mistake-images').createSignedUrls([...new Set(paths)], ttl)
    ;(signed || []).forEach((s: any) => { if (s.signedUrl) urlMap.set(s.path, s.signedUrl) })
  }
  const inject = (html: string | null) => (html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/data-storage-path="([^"]+)"/)
    if (!m) return tag
    const url = urlMap.get(m[1])
    const clean = tag.replace(/\ssrc\s*=\s*"[^"]*"/gi, '').replace(/\s*\/?>$/, '')
    return url ? `${clean} src="${url}">` : `${clean} alt="图片加载失败，请检查网络或存储配置">`
  })
  const mistakes = (rows || []).map((r: any) => ({
    id: r.id, title: r.title, content: inject(r.content), answer: inject(r.answer), analysis: inject(r.analysis),
    knowledgePoints: r.knowledge_points, cause: r.cause, difficulty: r.difficulty,
    mistakeDate: r.mistake_date, subjectName: r.subject?.name || '未分类',
    images: (r.images || []).map((i: any) => urlMap.get(i.storage_path)).filter(Boolean)
  }))

  await admin.from('share_links').update({ view_count: (link.view_count || 0) + 1 }).eq('id', link.id)
  return NextResponse.json({
    title: '错题分享', expiresAt: link.expires_at, count: mistakes.length,
    kind: 'mistake', mistakes, notes: [], schedules: []
  })
}
