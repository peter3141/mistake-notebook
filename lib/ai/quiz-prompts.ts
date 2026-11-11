import type { AiQuizQuestion } from '@/types'
import { parseJsonLoose } from './prompts'
import { MAX_TEXT_CHARS } from './prompts'

/**
 * v5 课本 AI 补充出题提示词。
 * ★ 技术边界：Coding Plan 只有 Chat/Completions，没有联网搜索能力。
 *   这里明确禁止模型「搜课本」「猜版本」「补全材料外内容」，
 *   材料不足时必须返回原因，而不是编题。
 */
export const TEXTBOOK_QUIZ_SYSTEM = `你是「课本同步练习」出题助手。你【没有联网能力】，也不能访问任何课本数据库。你唯一可以使用的依据是用户消息里【用户提供的课本材料】。

铁律（违反任何一条都算失败）：
1. 仅基于以下课本材料出题，不得引入材料之外的内容；不得凭记忆引用其他版本、其他出版社、其他章节的知识，不得自行补全题目条件。
2. 如果材料不足以出满要求的题量，或材料只有目录/标题而没有具体概念、定义、公式、例题，必须返回 {"insufficient":true,"reason":"具体说明缺什么材料"}，不要编造任何题目。
3. 题干、选项、答案、解析里的每个知识点与数据都必须能在材料里找到依据；不确定时宁可返回不足原因。
4. 每题都要给 confidence_note，写明「依据材料中的哪部分」以及「可能偏离课本、需人工核对」的风险提示。
5. 只输出一个 JSON 对象，不要 Markdown 代码块、不要解释文字。

输出格式（严格）：
{
 "insufficient": false,
 "reason": "",
 "questions": [
   {
    "stem": "题干（保留公式，可用 $...$ 表示）",
    "options": ["A 选项文字","B 选项文字"],
    "answer": "答案",
    "analysis": "解析，必须引用材料依据",
    "chapter": "对应章节标题（只能填用户给定的章节）",
    "difficulty": 3,
    "confidence_note": "依据：材料中的…；AI生成，需核对，可能偏离课本"
   }
 ]
}
材料不足时输出：{"insufficient":true,"reason":"…","questions":[]}
difficulty 必须是 1-5 的整数；options 没有选择题时填空数组 []。`

export interface QuizPromptInput {
  subject: string
  textbook: string
  chapterTitle: string
  materialText: string
  count: number
  difficultyMin: number
  difficultyMax: number
  questionType: string
  regenerateOf?: string
}

export function buildTextbookQuizPrompt(i: QuizPromptInput) {
  return [
    `【科目】${i.subject || '(未填写)'}`,
    `【课本】${i.textbook || '(未填写)'}（版本由用户维护，禁止自行推断或匹配）`,
    `【章节】${i.chapterTitle || '(未命名章节)'}`,
    `【题量】${i.count} 道`,
    `【难度】${i.difficultyMin}-${i.difficultyMax} 星`,
    `【题型偏好】${i.questionType || '课本同步练习'}`,
    i.regenerateOf ? `【单题重新生成】请生成 1 道与下面这道题不同的新题，但仍只能基于材料：${i.regenerateOf.slice(0, 500)}` : '',
    '',
    '【用户提供的课本材料开始】',
    i.materialText.slice(0, MAX_TEXT_CHARS),
    '【用户提供的课本材料结束】',
    '',
    '以上材料是唯一依据。材料不足就返回 insufficient=true 与具体原因，不要编题、不要联网、不要引用材料之外的知识。'
  ].filter(Boolean).join('\n')
}

export interface ParsedQuizResult {
  insufficient: boolean
  reason: string
  questions: AiQuizQuestion[]
}

/** 容错解析 + 补齐字段：任何不合法结构都不会让前端白屏，也不会被当成「可编题」放行 */
export function parseQuizResult(raw: string, fallbackChapter: string, limit: number): ParsedQuizResult {
  const j = parseJsonLoose<{
    insufficient?: boolean
    reason?: string
    questions?: Array<Partial<AiQuizQuestion>>
  }>(raw)
  if (j?.insufficient) {
    return { insufficient: true, reason: String(j.reason || '模型判定课本材料不足，未生成题目'), questions: [] }
  }
  const arr = Array.isArray(j?.questions) ? j.questions : []
  const questions: AiQuizQuestion[] = arr
    .filter((q) => q && typeof q.stem === 'string' && q.stem.trim())
    .slice(0, limit)
    .map((q) => ({
      stem: String(q.stem).trim().slice(0, 2000),
      options: Array.isArray(q.options) ? q.options.map(String).slice(0, 8) : [],
      answer: String(q.answer || '').trim().slice(0, 1000),
      analysis: String(q.analysis || '').trim().slice(0, 2000),
      chapter: String(q.chapter || fallbackChapter).trim().slice(0, 200),
      difficulty: Math.min(5, Math.max(1, Number(q.difficulty) || 3)),
      confidence_note: String(q.confidence_note || 'AI生成，需核对，可能偏离课本').slice(0, 300)
    }))
  if (!questions.length) {
    return { insufficient: true, reason: '模型未返回任何可用题目（通常是材料信息量不足），未编造题目', questions: [] }
  }
  return { insufficient: false, reason: '', questions }
}
