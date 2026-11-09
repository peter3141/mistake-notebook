import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { sanitizeHtml, todayISO } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const Body = z.object({
  preview: z.boolean().default(true),
  data: z.any()
})

/** CSV 中文表头 / 英文列名 → 数据库字段（错题） */
const FIELD_MAP: Record<string, string> = {
  '标题': 'title', '题目正文': 'content', '题目': 'content', '答案': 'answer', '解析': 'analysis',
  '科目': 'subject', '知识点': 'knowledge_points', '错因': 'cause', '难度': 'difficulty',
  '来源': 'source', '掌握状态': 'mastery', '错题日期': 'mistake_date', '标签': 'tags',
  title: 'title', content: 'content', answer: 'answer', analysis: 'analysis', subject: 'subject',
  knowledge_points: 'knowledge_points', cause: 'cause', difficulty: 'difficulty', source: 'source',
  mastery: 'mastery', mistake_date: 'mistake_date', tags: 'tags'
}

const MISTAKE_FIELDS = [
  'title', 'content', 'answer', 'analysis', 'subject', 'knowledge_points',
  'cause', 'difficulty', 'source', 'mastery', 'mistake_date', 'tags'
]

function extractRows(data: any) {
  const raw: any[] = Array.isArray(data) ? data : Array.isArray(data?.mistakes) ? data.mistakes : []
  const mapping: Record<string, string> = {}
  const rows = raw.map((r) => {
    const o: any = {}
    Object.entries(r || {}).forEach(([k, v]) => {
      const target = FIELD_MAP[k] || FIELD_MAP[k.trim()]
      if (target && MISTAKE_FIELDS.includes(target)) { o[target] = v; mapping[k] = target }
    })
    return o
  })
  // v2：其它模块按数组原样带回（字段白名单在写入时再过滤）
  const notes: any[] = Array.isArray(data?.notes) ? data.notes.slice(0, 1000) : []
  const tasks: any[] = Array.isArray(data?.tasks) ? data.tasks.slice(0, 1000) : []
  const schedules: any[] = Array.isArray(data?.schedules) ? data.schedules.slice(0, 1000) : []
  const habits: any[] = Array.isArray(data?.habits) ? data.habits.slice(0, 1000) : []
  return { rows, mapping, notes, tasks, schedules, habits }
}

/** 导入前必须预览字段映射；确认后按新 id 追加，不覆盖已有数据（v2 支持全部模块） */
export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 })
  const { preview, data } = parsed.data
  const { rows, mapping, notes, tasks, schedules, habits } = extractRows(data)
  const total = rows.length + notes.length + tasks.length + schedules.length + habits.length
  if (!total) return NextResponse.json({ error: '没有识别到可导入的数据，请检查备份格式', code: 'NO_ROWS' }, { status: 400 })

  if (preview) {
    return NextResponse.json({
      count: rows.length, mapping,
      modules: {
        错题: rows.length, 笔记: notes.length, 待办: tasks.length,
        日程: schedules.length, 习惯: habits.length
      },
      sample: rows[0]
        ? `${String(rows[0].title || '').slice(0, 30)} | ${String(rows[0].content || '').replace(/<[^>]*>/g, '').slice(0, 40)}`
        : `${notes[0]?.title || tasks[0]?.title || schedules[0]?.title || habits[0]?.name || '(无标题)'}（其它模块）`,
      note: '确认导入后会按新 id 追加，不会覆盖已有数据；图片只导入路径记录，需保留原 Storage 桶。'
    })
  }

  // 科目 / 错题本 / 标签按名称复用或新建
  const { data: subjects } = await supabase.from('subjects').select('id,name').eq('user_id', user.id)
  const subjectMap = new Map((subjects || []).map((s: any) => [s.name, s.id]))
  let imported = 0

  for (const r of rows.slice(0, 1000)) {
    let subjectId: string | null = null
    const sname = String(r.subject || '').trim()
    if (sname) {
      if (!subjectMap.has(sname)) {
        const { data: created } = await supabase.from('subjects').insert({ user_id: user.id, name: sname }).select('id').single()
        if (created) subjectMap.set(sname, created.id)
      }
      subjectId = subjectMap.get(sname) || null
    }
    const kp = Array.isArray(r.knowledge_points) ? r.knowledge_points : String(r.knowledge_points || '').split(/[|、,，]/).map((s) => s.trim()).filter(Boolean)
    const payload = {
      user_id: user.id, subject_id: subjectId,
      title: String(r.title || '导入的错题').slice(0, 300),
      content: sanitizeHtml(String(r.content || '')),
      answer: sanitizeHtml(String(r.answer || '')),
      analysis: sanitizeHtml(String(r.analysis || '')),
      knowledge_points: kp,
      cause: ['计算错误', '概念不清', '审题错误', '公式记错', '步骤遗漏', '粗心', '其他'].includes(String(r.cause)) ? r.cause : '其他',
      difficulty: Math.min(5, Math.max(1, Number(r.difficulty) || 3)),
      source: String(r.source || '').slice(0, 200),
      mastery: ['unmastered', 'fuzzy', 'mastered'].includes(String(r.mastery)) ? r.mastery : 'unmastered',
      mistake_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.mistake_date)) ? r.mistake_date : todayISO()
    }
    const { data: m, error } = await supabase.from('mistakes').insert(payload).select('id').single()
    if (error || !m) continue
    const names = Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(/[|、,，#]/).map((s: string) => s.trim()).filter(Boolean)
    for (const name of [...new Set(names)].slice(0, 20) as string[]) {
      const { data: tag } = await supabase.from('tags').upsert({ user_id: user.id, name }, { onConflict: 'user_id,name' }).select('id').single()
      if (tag) await supabase.from('mistake_tags').insert({ user_id: user.id, mistake_id: m.id, tag_id: tag.id })
    }
    imported++
  }

  // ---- v2：笔记（只写白名单字段，不复制 user_id / 关联 id / 版本） ----
  for (const n of notes) {
    const { error } = await supabase.from('notes').insert({
      user_id: user.id,
      title: String(n.title || '导入的笔记').slice(0, 300),
      content: sanitizeHtml(String(n.content || '')),
      tags: Array.isArray(n.tags) ? n.tags.slice(0, 20).map(String) : [],
      summary: String(n.summary || '').slice(0, 500)
    })
    if (!error) imported++
  }

  // ---- v2：待办 ----
  for (const t of tasks) {
    const { error } = await supabase.from('tasks').insert({
      user_id: user.id,
      title: String(t.title || '导入的任务').slice(0, 300),
      description: String(t.description || '').slice(0, 2000),
      priority: [1, 2, 3].includes(Number(t.priority)) ? Number(t.priority) : 2,
      due_at: t.due_at || null,
      completed: !!t.completed,
      repeat_rule: ['none', 'daily', 'weekly', 'monthly'].includes(String(t.repeat_rule)) ? t.repeat_rule : 'none',
      tags: Array.isArray(t.tags) ? t.tags.slice(0, 20).map(String) : []
    })
    if (!error) imported++
  }

  // ---- v2：日程 ----
  for (const s of schedules) {
    const start = s.start_at && !isNaN(new Date(s.start_at).getTime()) ? s.start_at : new Date().toISOString()
    const { error } = await supabase.from('schedules').insert({
      user_id: user.id,
      title: String(s.title || '导入的日程').slice(0, 300),
      description: String(s.description || '').slice(0, 2000),
      start_at: start, end_at: s.end_at || null,
      all_day: !!s.all_day, location: String(s.location || '').slice(0, 200),
      category: ['学习', '工作', '生活', '复习', '其他'].includes(String(s.category)) ? s.category : '其他',
      priority: [1, 2, 3].includes(Number(s.priority)) ? Number(s.priority) : 2,
      status: ['todo', 'done', 'cancelled'].includes(String(s.status)) ? s.status : 'todo',
      repeat_rule: ['none', 'daily', 'weekly', 'monthly'].includes(String(s.repeat_rule)) ? s.repeat_rule : 'none',
      remind_minutes: Number(s.remind_minutes) || 15
    })
    if (!error) imported++
  }

  // ---- v2：习惯 ----
  for (const h of habits) {
    const { error } = await supabase.from('habits').insert({
      user_id: user.id,
      name: String(h.name || '导入的习惯').slice(0, 100),
      color: String(h.color || '#6366f1').slice(0, 20),
      target_per_week: Math.min(7, Math.max(1, Number(h.target_per_week) || 7))
    })
    if (!error) imported++
  }

  return NextResponse.json({ count: imported })
}
