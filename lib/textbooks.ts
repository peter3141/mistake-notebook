'use client'

/**
 * v5「按科目课本组卷」数据层（增量模块，不改动 lib/data.ts / lib/data-v2.ts 的原有能力）
 *
 * 技术边界（必须遵守）：
 *  · 本项目接入的 Coding Plan 只有 Chat/Completions，没有联网搜索能力；
 *    这里所有课本数据都来自用户上传/录入的材料，或用户维护的章节↔知识点/错题映射。
 *  · 图片 / PDF 一律走 /api/images/upload → Supabase Storage，数据库只存路径，绝不存 Base64。
 *  · 抽题只查 mistakes（真实错题）；AI 生成题只存在于内存/组卷结果里，不写入错题库。
 */
import { db, signPaths, listMistakes } from './data'
import { compressForUpload } from './images/compress'
import type {
  Textbook, TextbookInput, TextbookChapter, ChapterInput, ChapterKnowledgePoint,
  ChapterMistake, TextbookMaterial, TextbookMaterialType, TextbookQuizTemplate,
  TextbookQuizConfig, PaperItem, AiQuizQuestion, ParsedChapter, Mistake
} from '@/types'

const BUCKET = 'mistake-images'

async function me() {
  const { data } = await db().auth.getUser()
  if (!data.user) throw new Error('请先登录')
  return data.user.id
}

// ===========================================================================
// 粘贴目录 → 两级章节树（章 → 节）
// 支持："第一章 集合"、"第2章 函数"、"1.1 集合的概念"、"1.2 ..."、"1 集合"
// 自动去掉目录点线与尾部页码，如 "1.1 集合的概念 ......... 3"
// ===========================================================================
export function parseCatalog(raw: string): ParsedChapter[] {
  const lines = String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const out: ParsedChapter[] = []
  let chapterSeq = 0
  let sectionSeq = 0
  let seenChapter = false

  for (const line of lines) {
    // 去点线 / 尾部页码 / 项目符号
    const text = line
      .replace(/^[•·\-*▶\s]+/, '')
      .replace(/[.·…．]{2,}\s*\d*\s*$/, '')
      .replace(/\s+\d{1,4}\s*$/, '')
      .trim()
    if (!text) continue

    const cnChapter = text.match(/^第\s*([一二三四五六七八九十百零〇两0-9]+)\s*([章篇单元部])\s*[：:、.．\-]?\s*(.*)$/)
    const dotted = text.match(/^(\d+(?:\.\d+)+)\s*[、.．:：]?\s*(.*)$/)
    const plainNo = text.match(/^(\d{1,2})\s*[、.．:：]\s*(.+)$/)

    if (cnChapter) {
      chapterSeq += 1; sectionSeq = 0; seenChapter = true
      out.push({
        chapter_no: `第${cnChapter[1]}${cnChapter[2]}`,
        title: (cnChapter[3] || '').trim() || `第${cnChapter[1]}${cnChapter[2]}`,
        level: 1, sort_order: chapterSeq * 100
      })
      continue
    }
    if (dotted) {
      const no = dotted[1], title = (dotted[2] || '').trim()
      if (seenChapter) {
        sectionSeq += 1
        out.push({ chapter_no: no, title: title || no, level: 2, sort_order: chapterSeq * 100 + sectionSeq * 10 })
      } else {
        // 目录直接从 "1.1" 开始时，退化为一级章节，仍保证树结构可用
        chapterSeq += 1
        out.push({ chapter_no: no, title: title || no, level: 1, sort_order: chapterSeq * 100 })
      }
      continue
    }
    if (plainNo && !seenChapter) {
      chapterSeq += 1
      out.push({ chapter_no: plainNo[1], title: plainNo[2].trim(), level: 1, sort_order: chapterSeq * 100 })
      continue
    }
    // 其它行（无编号）：作为当前章下的一节，或独立一级章节
    if (seenChapter) {
      sectionSeq += 1
      out.push({ chapter_no: '', title: text, level: 2, sort_order: chapterSeq * 100 + sectionSeq * 10 })
    } else {
      chapterSeq += 1
      out.push({ chapter_no: '', title: text, level: 1, sort_order: chapterSeq * 100 })
    }
  }
  return out
}

// ===========================================================================
// 课本 CRUD
// ===========================================================================
export async function listTextbooks(f: { subject_id?: string; grade?: string; edition?: string } = {}): Promise<Textbook[]> {
  const supabase = db()
  let q = supabase.from('textbooks').select('*, subject:subjects(id,name,color)').is('deleted_at', null).order('created_at', { ascending: false })
  if (f.subject_id) q = q.eq('subject_id', f.subject_id)
  if (f.grade) q = q.eq('grade', f.grade)
  if (f.edition) q = q.eq('edition', f.edition)
  const { data, error } = await q
  if (error) throw error
  const rows = (data || []) as Textbook[]
  if (!rows.length) return rows
  const { data: chapters } = await supabase.from('textbook_chapters')
    .select('id, textbook_id').is('deleted_at', null)
    .in('textbook_id', rows.map((r) => r.id))
  const counts = new Map<string, number>()
  ;(chapters || []).forEach((c: any) => counts.set(c.textbook_id, (counts.get(c.textbook_id) || 0) + 1))
  return rows.map((r) => ({ ...r, chapterCount: counts.get(r.id) || 0 }))
}

export async function getTextbook(id: string): Promise<Textbook | null> {
  const { data, error } = await db().from('textbooks').select('*, subject:subjects(id,name,color)').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Textbook) || null
}

export async function upsertTextbook(input: TextbookInput, id?: string): Promise<string> {
  const userId = await me()
  const payload: Record<string, unknown> = { ...input, user_id: userId }
  delete payload.subject; delete payload.chapterCount; delete payload.created_at; delete payload.updated_at
  const { data, error } = id
    ? await db().from('textbooks').update(payload).eq('id', id).eq('user_id', userId).select('id').single()
    : await db().from('textbooks').insert(payload).select('id').single()
  if (error) throw error
  return data.id as string
}

/** 删除课本前的影响范围说明（二次确认用） */
export async function textbookDeleteImpact(id: string) {
  const supabase = db()
  const { data: chapters } = await supabase.from('textbook_chapters').select('id').eq('textbook_id', id).is('deleted_at', null)
  const chapterIds = (chapters || []).map((c: any) => c.id)
  const { count: materials } = await supabase.from('textbook_materials')
    .select('id', { count: 'exact', head: true }).eq('textbook_id', id).is('deleted_at', null)
  let kps = 0, links = 0
  if (chapterIds.length) {
    const a = await supabase.from('chapter_knowledge_points').select('id', { count: 'exact', head: true }).in('chapter_id', chapterIds)
    const b = await supabase.from('chapter_mistakes').select('id', { count: 'exact', head: true }).in('chapter_id', chapterIds)
    kps = a.count || 0; links = b.count || 0
  }
  return { chapters: chapterIds.length, materials: materials || 0, kps, links }
}

/** 软删除课本：连带章节与材料一起进统一回收站（30 天内可恢复） */
export async function softDeleteTextbookWithRelations(id: string) {
  const supabase = db()
  const now = new Date().toISOString()
  const { error } = await supabase.from('textbooks').update({ deleted_at: now }).eq('id', id)
  if (error) throw error
  await supabase.from('textbook_chapters').update({ deleted_at: now }).eq('textbook_id', id).is('deleted_at', null)
  await supabase.from('textbook_materials').update({ deleted_at: now }).eq('textbook_id', id).is('deleted_at', null)
}

// ===========================================================================
// 章节树
// ===========================================================================
export async function listChapterRows(textbookId: string): Promise<TextbookChapter[]> {
  const { data, error } = await db().from('textbook_chapters').select('*')
    .eq('textbook_id', textbookId).is('deleted_at', null)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as TextbookChapter[]
}

export function buildChapterTree(rows: TextbookChapter[]): TextbookChapter[] {
  const map = new Map<string, TextbookChapter>()
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }))
  const roots: TextbookChapter[] = []
  map.forEach((r) => {
    if (r.parent_id && map.has(r.parent_id)) (map.get(r.parent_id)!.children || []).push(r)
    else roots.push(r)
  })
  return roots
}

export function flattenChapters(rows: TextbookChapter[]): TextbookChapter[] {
  return rows.flatMap((r) => [r, ...(r.children || [])])
}

export async function upsertChapter(input: ChapterInput, id?: string): Promise<string> {
  const userId = await me()
  const payload: Record<string, unknown> = { ...input, user_id: userId }
  delete payload.children; delete payload.materialCount; delete payload.mistakeCount; delete payload.created_at
  const { data, error } = id
    ? await db().from('textbook_chapters').update(payload).eq('id', id).eq('user_id', userId).select('id').single()
    : await db().from('textbook_chapters').insert(payload).select('id').single()
  if (error) throw error
  return data.id as string
}

/** 批量导入目录：逐条插入以拿到父章节 id，保持章→节两级顺序 */
export async function bulkImportChapters(textbookId: string, parsed: ParsedChapter[]) {
  const userId = await me()
  const supabase = db()
  let parentId: string | null = null
  let created = 0
  for (const p of parsed) {
    const { data, error } = await supabase.from('textbook_chapters').insert({
      user_id: userId, textbook_id: textbookId,
      parent_id: p.level === 2 ? parentId : null,
      level: p.level, chapter_no: p.chapter_no, title: p.title,
      sort_order: p.sort_order, page_range: null, summary: ''
    }).select('id').single()
    if (error) throw error
    if (p.level === 1) parentId = data.id as string
    created += 1
  }
  return created
}

/** 拖拽排序：只更新 sort_order，不改父子层级 */
export async function reorderChapters(updates: { id: string; sort_order: number }[]) {
  const supabase = db()
  for (const u of updates) {
    const { error } = await supabase.from('textbook_chapters').update({ sort_order: u.sort_order }).eq('id', u.id)
    if (error) throw error
  }
}

export async function softDeleteChapterWithRelations(id: string) {
  const supabase = db()
  const now = new Date().toISOString()
  const { error } = await supabase.from('textbook_chapters').update({ deleted_at: now }).eq('id', id)
  if (error) throw error
  await supabase.from('textbook_chapters').update({ deleted_at: now }).eq('parent_id', id).is('deleted_at', null)
  await supabase.from('textbook_materials').update({ deleted_at: now }).eq('chapter_id', id).is('deleted_at', null)
}

// ===========================================================================
// 章节 ↔ 知识点 / 错题映射
// ===========================================================================
export async function listChapterKps(chapterId: string): Promise<ChapterKnowledgePoint[]> {
  const { data, error } = await db().from('chapter_knowledge_points').select('*')
    .eq('chapter_id', chapterId).order('weight', { ascending: false })
  if (error) throw error
  return (data || []) as ChapterKnowledgePoint[]
}
export async function addChapterKp(chapterId: string, knowledgePoint: string, weight = 1) {
  const userId = await me()
  const { error } = await db().from('chapter_knowledge_points').upsert({
    user_id: userId, chapter_id: chapterId, knowledge_point: knowledgePoint.trim(), weight
  }, { onConflict: 'chapter_id,knowledge_point' })
  if (error) throw error
}
export async function removeChapterKp(id: string) {
  const { error } = await db().from('chapter_knowledge_points').delete().eq('id', id)
  if (error) throw error
}

export async function listLinkedMistakes(chapterId: string): Promise<Array<{ id: string; title: string }>> {
  const supabase = db()
  const { data: links } = await supabase.from('chapter_mistakes').select('mistake_id').eq('chapter_id', chapterId)
  const ids = (links || []).map((l: any) => l.mistake_id as string)
  if (!ids.length) return []
  const { data } = await supabase.from('mistakes').select('id,title').in('id', ids).is('deleted_at', null)
  return (data || []) as Array<{ id: string; title: string }>
}
export async function linkMistakeToChapter(chapterId: string, mistakeId: string) {
  const userId = await me()
  const { error } = await db().from('chapter_mistakes').upsert({
    user_id: userId, chapter_id: chapterId, mistake_id: mistakeId
  }, { onConflict: 'chapter_id,mistake_id' })
  if (error) throw error
}
export async function unlinkMistakeFromChapter(chapterId: string, mistakeId: string) {
  const { error } = await db().from('chapter_mistakes').delete().eq('chapter_id', chapterId).eq('mistake_id', mistakeId)
  if (error) throw error
}
export async function searchMistakesForLink(q: string): Promise<Array<{ id: string; title: string }>> {
  const r = await listMistakes({ q: q || undefined, pageSize: 30 })
  return r.rows.map((m) => ({ id: m.id, title: m.title || '（无标题）' }))
}

// ===========================================================================
// 课本材料：图片 / PDF 走 /api/images/upload，只存路径；纯文本可直接录入
// ===========================================================================
export async function listMaterials(chapterId: string): Promise<TextbookMaterial[]> {
  const { data, error } = await db().from('textbook_materials').select('*')
    .eq('chapter_id', chapterId).is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data || []) as TextbookMaterial[]
  const urls = await signPaths(rows.map((r) => r.storage_path).filter(Boolean) as string[])
  return rows.map((r) => ({ ...r, signedUrl: r.storage_path ? urls.get(r.storage_path) || '' : '' }))
}

export async function addTextMaterial(chapterId: string, textbookId: string, text: string, type: TextbookMaterialType = 'text') {
  const userId = await me()
  const { error } = await db().from('textbook_materials').insert({
    user_id: userId, chapter_id: chapterId, textbook_id: textbookId,
    material_type: type, storage_path: null, mime_type: 'text/plain',
    size_bytes: new Blob([text]).size, ocr_text: text, file_name: '手动录入的课本片段'
  })
  if (error) throw error
}
export async function softDeleteMaterial(id: string) {
  const { error } = await db().from('textbook_materials').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/** 章节是否具备「真实课本材料」：有文字材料/OCR 文本，或填了章节摘要 */
export async function chapterMaterialState(chapterId: string) {
  const supabase = db()
  const { data: chapter } = await supabase.from('textbook_chapters').select('summary').eq('id', chapterId).maybeSingle()
  const { data: textRows } = await supabase.from('textbook_materials').select('ocr_text')
    .eq('chapter_id', chapterId).is('deleted_at', null)
  const { count: files } = await supabase.from('textbook_materials').select('id', { count: 'exact', head: true })
    .eq('chapter_id', chapterId).is('deleted_at', null).not('storage_path', 'is', null)
  const summary = String(chapter?.summary || '').trim()
  const ocrLen = (textRows || []).reduce((n: number, r: any) => n + String(r.ocr_text || '').trim().length, 0)
  // 与服务端 /api/ai/textbook-quiz 的材料门槛保持一致：摘要 + OCR 文本合计至少 20 字
  return {
    hasSummary: summary.length >= 10,
    hasTextMaterial: ocrLen >= 10,
    hasFiles: (files || 0) > 0,
    ready: summary.length + ocrLen >= 20
  }
}

/** 读取本章可用的文字材料（摘要 + OCR 文本），供 AI 请求体携带；
 *  服务端仍会以数据库里的材料为准重新读取，不信任请求体内容。 */
export async function getChapterMaterialText(chapterId: string): Promise<string> {
  const supabase = db()
  const { data: chapter } = await supabase.from('textbook_chapters').select('summary').eq('id', chapterId).maybeSingle()
  const { data: mats } = await supabase.from('textbook_materials')
    .select('ocr_text').eq('chapter_id', chapterId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(20)
  return [
    String(chapter?.summary || '').trim() ? `【章节内容摘要】\n${String(chapter?.summary || '').trim()}` : '',
    ...(mats || []).map((m: any, i: number) => String(m.ocr_text || '').trim() ? `【课本材料片段 ${i + 1}】\n${String(m.ocr_text).trim()}` : '').filter(Boolean)
  ].filter(Boolean).join('\n\n').slice(0, 8000)
}

/** 上传课本图片（先压缩）或 PDF 片段；数据库只记路径，服务端写 textbook_materials */
export async function uploadTextbookMaterial(
  chapterId: string, textbookId: string, file: File,
  type: TextbookMaterialType, ocrText = ''
): Promise<TextbookMaterial> {
  const isImage = file.type.startsWith('image/')
  const fd = new FormData()
  if (isImage) {
    const c = await compressForUpload(file)
    fd.append('file', c.file, c.file.name)
    if (c.thumbnail) fd.append('thumbnail', c.thumbnail, c.thumbnail.name)
    fd.append('width', String(c.width)); fd.append('height', String(c.height))
    fd.append('originalSize', String(c.originalSize))
  } else {
    fd.append('file', file, file.name)
  }
  fd.append('chapterId', chapterId)
  fd.append('textbookId', textbookId)
  fd.append('materialType', type)
  fd.append('ocrText', ocrText)
  const r = await fetch('/api/images/upload', { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({} as any))
  if (!r.ok) throw new Error(j.error || `上传失败（HTTP ${r.status}）`)
  return j.material as TextbookMaterial
}

/** 课本封面（可选）：同样走 /api/images/upload，只把路径写进 textbooks.cover_path */
export async function uploadTextbookCover(textbookId: string, file: File): Promise<string> {
  const c = await compressForUpload(file)
  const fd = new FormData()
  fd.append('file', c.file, c.file.name)
  fd.append('textbookId', textbookId)
  fd.append('cover', '1')
  const r = await fetch('/api/images/upload', { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({} as any))
  if (!r.ok) throw new Error(j.error || `封面上传失败（HTTP ${r.status}）`)
  return j.cover_path as string
}

// ===========================================================================
// 按章节抽真实错题（三级优先级）
// ===========================================================================
export interface DrawResult {
  items: PaperItem[]
  shortfall: number
  chapterTitles: string[]
  directCount: number
  indirectCount: number
}

export async function drawByChapters(cfg: TextbookQuizConfig): Promise<DrawResult> {
  const supabase = db()
  const rows = await listChapterRows(cfg.textbook_id)
  const flat = flattenChapters(buildChapterTree(rows))
  const titleOf = new Map<string, string>()
  flat.forEach((c) => titleOf.set(c.id, `${c.chapter_no ? c.chapter_no + ' ' : ''}${c.title}`))

  // 选了「章」时自动包含其下所有「节」；选「节」时只选该节
  const selected = new Set<string>()
  for (const id of cfg.chapter_ids) {
    const ch = flat.find((c) => c.id === id)
    if (!ch) continue
    selected.add(id)
    if (ch.level === 1) flat.forEach((c) => { if (c.parent_id === id) selected.add(c.id) })
  }
  const ids = [...selected]
  const chapterTitles = ids.map((id) => titleOf.get(id) || '未命名章节')
  if (!ids.length) return { items: [], shortfall: cfg.count, chapterTitles: [], directCount: 0, indirectCount: 0 }

  // ① 直接关联到所选章节的错题（chapter_mistakes）
  const { data: directLinks } = await supabase.from('chapter_mistakes')
    .select('chapter_id, mistake_id').in('chapter_id', ids)
  // ② 章节映射的知识点（用于间接命中错题的知识点 / 标签）
  const { data: kps } = await supabase.from('chapter_knowledge_points')
    .select('chapter_id, knowledge_point, weight').in('chapter_id', ids)

  const r = await listMistakes({ subject_id: cfg.subject_id || undefined, pageSize: 500, sort: 'errors' })
  const candidates = r.rows.filter((m) => {
    if (m.deleted_at) return false
    if (m.difficulty < cfg.difficulty_min || m.difficulty > cfg.difficulty_max) return false
    if (cfg.only_weak && m.mastery === 'mastered' && (m.error_count || 0) === 0) return false
    return true
  })
  const byId = new Map(candidates.map((m) => [m.id, m]))

  const direct: PaperItem[] = []
  const directIds = new Set<string>()
  for (const l of (directLinks || []) as ChapterMistake[]) {
    const m = byId.get(l.mistake_id)
    if (!m || directIds.has(m.id)) continue
    directIds.add(m.id)
    direct.push({ key: `real-${m.id}`, kind: 'real', mistake: m, chapterTitle: titleOf.get(l.chapter_id) || '未命名章节', matchType: 'direct' })
  }

  const kpList = (kps || []) as Array<{ chapter_id: string; knowledge_point: string; weight: number }>
  const indirect: Array<{ item: PaperItem; weight: number }> = []
  for (const m of candidates) {
    if (directIds.has(m.id)) continue
    const tags = (m.tags || []).map((t) => t.name)
    const haystack = [...(m.knowledge_points || []), ...tags].map((s) => String(s).trim()).filter(Boolean)
    const hit = kpList.find((k) => haystack.some((h) => h === k.knowledge_point || h.includes(k.knowledge_point) || k.knowledge_point.includes(h)))
    if (!hit) continue
    indirect.push({
      weight: Number(hit.weight) || 1,
      item: { key: `real-${m.id}`, kind: 'real', mistake: m, chapterTitle: titleOf.get(hit.chapter_id) || '未命名章节', matchType: 'knowledge' }
    })
  }

  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5)
  const items = [
    ...shuffle(direct),
    ...shuffle(indirect).sort((a, b) => b.weight - a.weight).map((x) => x.item)
  ].slice(0, Math.max(1, Math.min(50, cfg.count)))

  return {
    items,
    shortfall: Math.max(0, cfg.count - items.length),
    chapterTitles,
    directCount: direct.length,
    indirectCount: indirect.length
  }
}

// ===========================================================================
// 组卷配置模板（一键复用）
// ===========================================================================
export async function listQuizTemplates(): Promise<TextbookQuizTemplate[]> {
  const { data, error } = await db().from('textbook_quiz_templates').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as TextbookQuizTemplate[]
}
export async function saveQuizTemplate(name: string, config: TextbookQuizConfig) {
  const userId = await me()
  const { error } = await db().from('textbook_quiz_templates')
    .upsert({ user_id: userId, name: name.trim(), config }, { onConflict: 'user_id,name' })
  if (error) throw error
}
export async function deleteQuizTemplate(id: string) {
  const { error } = await db().from('textbook_quiz_templates').delete().eq('id', id)
  if (error) throw error
}

// ===========================================================================
// AI 补充出题（服务端四重门禁；这里只负责请求与错误透传）
// ===========================================================================
export interface QuizRequestPayload {
  subject: string
  textbook: string
  chapterTitle: string
  chapterId: string
  count: number
  difficultyMin: number
  difficultyMax: number
  questionType: string
  /** 章节内容摘要 / OCR 文本片段；服务端会忽略它并以数据库里的材料为准（防伪造） */
  materialText: string
  regenerateOf?: string
}
export interface QuizResponse {
  questions?: AiQuizQuestion[]
  insufficient?: boolean
  reason?: string
  notice?: string
  cached?: boolean
}

export async function requestTextbookQuiz(payload: QuizRequestPayload): Promise<QuizResponse> {
  const r = await fetch('/api/ai/textbook-quiz', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  })
  const j = await r.json().catch(() => ({} as any)) as QuizResponse & { error?: string; code?: string }
  if (!r.ok) {
    // 材料不足不是「报错白屏」，而是把原因原样交给前端展示；绝不降级成编题
    if (j.insufficient || j.code === 'INSUFFICIENT_MATERIAL') {
      return { insufficient: true, reason: j.reason || j.error || '课本材料不足', questions: [] }
    }
    throw new Error(j.error || `AI 出题失败（HTTP ${r.status}）`)
  }
  return j
}

const escapeHtml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 用户手动勾选「加入打印」后，把 AI 题临时适配成打印链路需要的 Mistake 形状。
 *  仅存在于 sessionStorage / 内存，绝不写入 mistakes 表。 */
export function aiQuestionToMistake(q: AiQuizQuestion, chapterTitle: string, index: number): Mistake {
  const options = (q.options || []).length
    ? `<p>${(q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${escapeHtml(o)}`).join('<br/>')}</p>` : ''
  const now = new Date().toISOString()
  return {
    id: `ai-preview-${index}-${Date.now()}`,
    user_id: '', book_id: null, subject_id: null,
    title: '【AI生成，需核对，可能偏离课本】',
    content: `<p>${escapeHtml(q.stem)}</p>${options}<p class="text-xs text-slate-500">来源章节：${escapeHtml(chapterTitle)} · AI生成，需核对，可能偏离课本</p>`,
    answer: escapeHtml(q.answer),
    analysis: escapeHtml(q.analysis),
    knowledge_points: [], cause: '其他',
    difficulty: Math.min(5, Math.max(1, Number(q.difficulty) || 3)),
    source: 'AI生成，需核对，可能偏离课本',
    mastery: 'unmastered', mistake_date: now.slice(0, 10),
    created_at: now, updated_at: now, next_review_at: now,
    review_interval_days: 0, review_count: 0, error_count: 0, deleted_at: null,
    ai_result: null, ai_applied_at: null, similar_questions: [], images: [], tags: [],
    subject: null, book: null
  }
}
