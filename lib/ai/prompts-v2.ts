/** v2：AI 日程解析 / AI 笔记总结 的提示词与结果归一化（纯文本任务，用 AI_MODEL，不用视觉模型） */
import { stripHtml } from '@/lib/utils'
import type { ScheduleParseResult, NoteSummaryResult, Priority, RepeatRule } from '@/types'
import { parseJsonLoose } from './prompts'

export const MAX_NOTE_CHARS = 8000
export const MAX_SCHEDULE_TEXT_CHARS = 1000

export const SCHEDULE_SYSTEM = `你是一个日程解析助手。把用户的一句自然语言解析成结构化日程，严格只输出一个 JSON 对象（不要 Markdown 代码块、不要解释），字段：
{
 "title": "日程标题（简洁）",
 "start_at": "ISO 8601 带时区的开始时间，例如 2026-11-09T15:00:00+08:00",
 "end_at": "ISO 8601 带时区的结束时间；无法确定时填 null",
 "all_day": false,
 "location": "地点；没有则空字符串",
 "category": "只能是：学习/工作/生活/复习/其他",
 "priority": 2,
 "repeat_rule": "none/daily/weekly/monthly",
 "notes": "补充说明（30字内）"
}
规则：
- 相对时间（明天、下周三、下午3点）要基于我给你的「当前时间」和「时区偏移」换算成绝对时间。
- 没说结束时间时，默认开始时间 + 1 小时；没说时长但说了"全天"则 all_day=true。
- priority 为整数 1(高)/2(中)/3(低)。
- 不确定时用最合理的默认，不要编造地点或人物。只输出 JSON。`

export function buildSchedulePrompt(text: string, nowISO: string, tzOffsetMinutes: number) {
  return [
    `当前时间：${nowISO}`,
    `用户所在时区相对 UTC 的偏移：+${tzOffsetMinutes} 分钟（例如 +480 表示东八区）`,
    `请解析这句话：\n${text.slice(0, MAX_SCHEDULE_TEXT_CHARS)}`
  ].join('\n')
}

const CATEGORIES = ['学习', '工作', '生活', '复习', '其他']
const REPEATS: RepeatRule[] = ['none', 'daily', 'weekly', 'monthly']

/** 归一化：防止模型给出非法字段导致前端预览/写库报错 */
export function normalizeScheduleResult(v: any): ScheduleParseResult {
  let start = new Date(typeof v?.start_at === 'string' ? v.start_at : Date.now())
  if (isNaN(start.getTime())) start = new Date(Date.now() + 3600000)
  let end: Date | null = null
  if (typeof v?.end_at === 'string' && v.end_at) {
    const d = new Date(v.end_at)
    if (!isNaN(d.getTime()) && d > start) end = d
  }
  if (!end) { end = new Date(start.getTime() + 3600000) }
  const p = Number(v?.priority)
  const priority: Priority = p === 1 || p === 2 || p === 3 ? p : 2
  return {
    title: String(v?.title || '新日程').slice(0, 200),
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    all_day: !!v?.all_day,
    location: String(v?.location || '').slice(0, 200),
    category: CATEGORIES.includes(String(v?.category)) ? String(v.category) : '学习',
    priority,
    repeat_rule: REPEATS.includes(String(v?.repeat_rule) as RepeatRule) ? String(v.repeat_rule) as RepeatRule : 'none',
    notes: String(v?.notes || '').slice(0, 500)
  }
}

export const NOTE_SYSTEM = `你是一位学习笔记整理助手。根据笔记内容生成结构化总结，严格只输出一个 JSON 对象（不要 Markdown 代码块、不要解释），字段：
{
 "summary": "100字以内的段落总结",
 "keyPoints": ["要点1","要点2","要点3"],
 "tags": ["建议标签1","建议标签2"],
 "reviewAdvice": "30字以内的复习建议"
}
不要编造原文没有的事实；看不懂的内容如实说明。只输出 JSON。`

export function buildNotePrompt(title: string, content: string, customTemplate?: string) {
  return [
    customTemplate ? `【用户自定义要求】\n${customTemplate.slice(0, 800)}\n` : '',
    `笔记标题：${title || '(无)'}`,
    `笔记正文：${stripHtml(content || '').slice(0, MAX_NOTE_CHARS)}`
  ].filter(Boolean).join('\n')
}

export function normalizeNoteResult(v: any): NoteSummaryResult {
  const arr = (x: any) => Array.isArray(x) ? x.filter((s) => typeof s === 'string').map((s: string) => s.slice(0, 200)).slice(0, 10) : []
  return {
    summary: String(v?.summary || '').slice(0, 500),
    keyPoints: arr(v?.keyPoints),
    tags: arr(v?.tags).slice(0, 6),
    reviewAdvice: String(v?.reviewAdvice || '').slice(0, 200)
  }
}

export { parseJsonLoose }
