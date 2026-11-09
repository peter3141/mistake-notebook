import type { AiOrganizeResult } from '@/types'
import { stripHtml } from '@/lib/utils'

export const MAX_TEXT_CHARS = 8000
export const MAX_IMAGE_BASE64_CHARS = 4 * 1024 * 1024 // ~4MB

export const ORGANIZE_SYSTEM = `你是一位严谨的中学学科老师，擅长把学生手写的错题整理成结构化笔记。
严格只输出一个 JSON 对象（不要 Markdown 代码块、不要解释），字段如下：
{
 "normalizedStem": "规范化后的题干（保留数学公式，用 $...$ 或 $$...$$ 包裹）",
 "knowledgePoints": ["知识点1","知识点2"],
 "cause": "错因，必须从以下取一个：计算错误/概念不清/审题错误/公式记错/步骤遗漏/粗心/其他",
 "steps": ["解题步骤1","解题步骤2"],
 "answerPoints": ["答案要点1","答案要点2"],
 "tags": ["建议标签1","建议标签2"],
 "difficulty": 3,
 "reviewAdvice": "30字以内的复习建议",
 "similarQuestions": ["1道同类练习题的题目描述（不要给答案）"]
}
不确定时宁可留空字符串/空数组，不要编造。difficulty 是 1-5 的整数。`

export function buildOrganizePrompt(input: {
  title?: string; content?: string; answer?: string; analysis?: string
  hasImages?: boolean; customTemplate?: string
}) {
  const text = [
    `标题：${input.title || '(无)'}`,
    `题目正文：${stripHtml(input.content || '').slice(0, MAX_TEXT_CHARS)}`,
    `已有答案：${stripHtml(input.answer || '').slice(0, 2000)}`,
    `已有解析：${stripHtml(input.analysis || '').slice(0, 2000)}`
  ].join('\n')
  return [
    input.customTemplate ? `【用户自定义要求】\n${input.customTemplate.slice(0, 1500)}\n` : '',
    input.hasImages ? '（本题含图片，请结合图片内容一起整理；图片里若有公式请用 LaTeX 写进 normalizedStem）' : '',
    '请整理下面这道错题：\n',
    text
  ].filter(Boolean).join('\n')
}

export const OCR_SYSTEM = `你是 OCR 与数学公式识别助手。请识别图片中的文字与公式，严格只输出 JSON：
{"text":"识别出的完整文字，保留段落与换行","formulas":["$E=mc^2$","$$\\\\frac{a}{b}$$"]}
公式统一用 LaTeX 并用 $...$（行内）或 $$...$$（独立）包裹。看不清的地方用 [?] 标注，不要编造内容。只输出 JSON。`

export const buildOcrPrompt = () => '请识别这张题目图片中的全部文字与数学公式。'

export const SIMILAR_SYSTEM = `你是出题老师。根据给定错题生成 3 道同类练习题，严格只输出 JSON：
{"questions":["题目1（含完整条件，用 $...$ 写公式）","题目2","题目3"]}
只给题目，不要给答案，不要解释。注意：这些题目是 AI 生成的，可能不严谨，必须标注需核对。`

export function buildSimilarPrompt(input: { title?: string; content?: string; knowledgePoints?: string[] }) {
  return [
    `原题标题：${input.title || '(无)'}`,
    `原题正文：${stripHtml(input.content || '').slice(0, MAX_TEXT_CHARS)}`,
    `知识点：${(input.knowledgePoints || []).join('、') || '(未填写)'}`,
    '请生成 3 道同知识点、难度相近的练习题。'
  ].join('\n')
}

/** 把模型返回文本容错解析为结构化 JSON */
export function parseJsonLoose<T>(raw: string): T {
  let s = (raw || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{'), end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s) as T
}

/** 补齐缺失字段，避免前端因模型输出不完整而白屏 */
export function normalizeOrganizeResult(v: Partial<AiOrganizeResult>): AiOrganizeResult {
  const arr = (x: unknown) => Array.isArray(x) ? x.filter((i) => typeof i === 'string').map(String) : []
  const validCauses = ['计算错误', '概念不清', '审题错误', '公式记错', '步骤遗漏', '粗心', '其他']
  return {
    normalizedStem: String(v.normalizedStem ?? ''),
    knowledgePoints: arr(v.knowledgePoints),
    cause: (validCauses.includes(String(v.cause)) ? v.cause : '其他') as AiOrganizeResult['cause'],
    steps: arr(v.steps),
    answerPoints: arr(v.answerPoints),
    tags: arr(v.tags),
    difficulty: Math.min(5, Math.max(1, Number(v.difficulty) || 3)),
    reviewAdvice: String(v.reviewAdvice ?? ''),
    similarQuestions: arr(v.similarQuestions)
  }
}
