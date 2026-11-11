import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toCsv } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** v5：合并后 38 张表全量导出（新增课本模块 6 张表；图片仍只导出路径） */
const TABLES = [
  'profiles', 'user_settings', 'subjects', 'mistake_books', 'tags', 'mistakes',
  'mistake_images', 'mistake_tags', 'review_logs', 'practice_logs', 'ai_jobs',
  'ai_usage_logs', 'mistake_versions', 'print_templates', 'share_links', 'ocr_jobs',
  'schedules', 'schedule_reminders', 'tasks', 'subtasks', 'notes', 'note_versions',
  'habits', 'habit_logs', 'focus_sessions', 'goals', 'goal_milestones',
  'attachments', 'trash_items', 'deleted_images', 'image_purge_failures',
  // v5：课本模块（课本 / 章节 / 映射 / 材料 / 组卷模板）
  'textbooks', 'textbook_chapters', 'chapter_knowledge_points',
  'chapter_mistakes', 'textbook_materials', 'textbook_quiz_templates'
] as const

/** 一键导出全部数据：JSON 全量备份 / CSV 错题清单 */
export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'json'
  const ids = (new URL(req.url).searchParams.get('ids') || '').split(',').filter(Boolean)

  const result: Record<string, unknown> = {}
  for (const t of TABLES) {
    const col = t === 'profiles' ? 'id' : 'user_id'
    let q = supabase.from(t).select('*').eq(col, user.id)
    if (ids.length && t === 'mistakes') q = q.in('id', ids)
    const { data } = await q
    result[t] = data || []
  }

  if (format === 'csv') {
    const headers = [
      { key: 'title', label: '标题' }, { key: 'content', label: '题目正文' }, { key: 'answer', label: '答案' },
      { key: 'analysis', label: '解析' }, { key: 'subject', label: '科目' }, { key: 'knowledge_points', label: '知识点' },
      { key: 'cause', label: '错因' }, { key: 'difficulty', label: '难度' }, { key: 'source', label: '来源' },
      { key: 'mastery', label: '掌握状态' }, { key: 'mistake_date', label: '错题日期' }, { key: 'tags', label: '标签' }
    ]
    const subjects = new Map((result.subjects as any[]).map((s) => [s.id, s.name]))
    const rows = (result.mistakes as any[]).map((m) => ({
      ...m, subject: subjects.get(m.subject_id) || '', knowledge_points: (m.knowledge_points || []).join('|'),
      content: String(m.content || '').replace(/<[^>]*>/g, ''),
      answer: String(m.answer || '').replace(/<[^>]*>/g, ''),
      analysis: String(m.analysis || '').replace(/<[^>]*>/g, '')
    }))
    return new Response(toCsv(rows, headers), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mistakes.csv"' }
    })
  }

  return NextResponse.json({
    version: 2, exportedAt: new Date().toISOString(), app: 'personal-hub',
    note: '图片文件保存在 Supabase Storage，本备份包含图片路径；恢复图片需连同 Storage 桶一起保留。本备份含全部模块数据。',
    ...result
  }, { headers: { 'Content-Disposition': 'attachment; filename="mistake-backup.json"' } })
}
