import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAi, aiErrorResponse } from '@/lib/ai/guard'
import { assertRateLimit, callCodingPlan, AiCallError } from '@/lib/ai/coding-plan'
import { findCached, createJob, finishJob, failJob, logUsage } from '@/lib/ai/job'
import { TEXTBOOK_QUIZ_SYSTEM, buildTextbookQuizPrompt, parseQuizResult } from '@/lib/ai/quiz-prompts'
import { sha256 } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  subject: z.string().max(80).optional(),
  textbook: z.string().max(120).optional(),
  chapterTitle: z.string().max(200).optional(),
  chapterId: z.string().uuid(),
  count: z.number().int().min(1).max(10).optional().default(3),
  difficultyMin: z.number().int().min(1).max(5).optional().default(1),
  difficultyMax: z.number().int().min(1).max(5).optional().default(5),
  questionType: z.string().max(80).optional(),
  /** 章节摘要 / OCR 文本片段（请求体按约定携带）。
   *  ★ 安全：服务端不信任它，出题依据一律以数据库里该用户自己的材料为准重新读取，
   *    防止请求体被塞入课本外内容或伪造材料绕过门禁。 */
  materialText: z.string().max(12000).optional(),
  regenerateOf: z.string().max(2000).optional()
})

const NOTICE = 'AI生成，需核对，可能偏离课本'

/**
 * v5 课本 AI 补充出题。
 *
 * ★ 四重门禁，全部发生在「发起任何 Coding Plan 请求」之前：
 *   ① AI 总开关           → requireAi('textbook_quiz')
 *   ② ai_textbook_quiz 子开关 → requireAi('textbook_quiz')
 *   ③ DASHSCOPE_CODING_API_KEY + AI_BASE_URL 等服务端配置 → requireAi → getAiConfig
 *   ④ 该章节有用户上传的课本材料（含 OCR 文字）或章节内容摘要 → 本路由从数据库校验
 * 任一不满足 → 直接返回明确错误码，零外部调用、零费用、不白屏、不降级成编题。
 *
 * ★ 本功能不做联网搜索：Coding Plan 只有 Chat/Completions。材料完全来自用户维护的数据。
 * ★ AI 结果只返回给前端预览，不写 mistakes / chapter_mistakes，不进入随机抽题池。
 */
export async function POST(req: Request) {
  let ctx
  try { ctx = await requireAi('textbook_quiz') }
  catch (e) { return aiErrorResponse(e) }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法', code: 'BAD_INPUT' }, { status: 400 })
  const b = parsed.data
  const count = b.count ?? 3
  const difficultyMin = b.difficultyMin ?? 1
  const difficultyMax = Math.max(difficultyMin, b.difficultyMax ?? 5)

  // ---------- ④ 材料门禁：服务端只认自己数据库里的用户材料 ----------
  // 请求体里的 b.materialText 只用于前端核对/排查，不参与提示词拼装。
  const { data: chapter, error: chErr } = await ctx.supabase.from('textbook_chapters')
    .select('id, title, chapter_no, summary, textbook_id')
    .eq('id', b.chapterId).eq('user_id', ctx.userId).is('deleted_at', null).maybeSingle()
  if (chErr) return NextResponse.json({ error: '读取章节失败：' + chErr.message, code: 'DB_ERROR' }, { status: 500 })
  if (!chapter) {
    return NextResponse.json({ error: '章节不存在或无权访问', code: 'CHAPTER_NOT_FOUND' }, { status: 404 })
  }

  const { data: mats, error: matErr } = await ctx.supabase.from('textbook_materials')
    .select('id, material_type, ocr_text, file_name')
    .eq('chapter_id', b.chapterId).eq('user_id', ctx.userId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(20)
  if (matErr) return NextResponse.json({ error: '读取课本材料失败：' + matErr.message, code: 'DB_ERROR' }, { status: 500 })

  const materialRows = mats || []
  const summary = String(chapter.summary || '').trim()
  const ocrParts = materialRows
    .map((m: any) => String(m.ocr_text || '').trim())
    .filter((s) => s.length > 0)
  const materialText = [
    summary ? `【章节内容摘要】\n${summary}` : '',
    ...ocrParts.map((s, i) => `【课本材料片段 ${i + 1}】\n${s}`)
  ].filter(Boolean).join('\n\n').trim()

  if (materialText.length < 20) {
    const reason = materialRows.length === 0
      ? '该章节既没有上传课本材料，也没有填写章节内容摘要。请到「课本 → 章节详情」上传图片/PDF 片段并填写 OCR 文字，或录入正文/例题文字。'
      : !summary && ocrParts.length === 0
        ? `已上传 ${materialRows.length} 份图片/PDF 材料，但都没有 OCR 文字，也没有章节内容摘要；纯图片无法作为出题依据。请在章节详情补充文字材料。`
        : '可用文字材料太少（不足 20 字），无法据此出题。请补充具体概念、定义、公式或例题。'
    return NextResponse.json({
      error: `课本材料不足，未生成任何题目：${reason}`,
      code: 'INSUFFICIENT_MATERIAL',
      insufficient: true, reason, questions: [], notice: NOTICE
    }, { status: 422 })
  }

  // ---------- 通过门禁后才允许调用 Coding Plan ----------
  const chapterTitle = `${chapter.chapter_no ? chapter.chapter_no + ' ' : ''}${chapter.title}`
  const prompt = buildTextbookQuizPrompt({
    subject: b.subject || '', textbook: b.textbook || '', chapterTitle,
    materialText, count, difficultyMin, difficultyMax,
    questionType: b.questionType || '', regenerateOf: b.regenerateOf
  })
  const model = ctx.config.textModel
  const hash = await sha256(`textbook_quiz|${model}|${prompt}`)
  const cached = await findCached(ctx.supabase, ctx.userId, 'textbook_quiz', hash)
  if (cached) {
    const c = cached as { insufficient?: boolean; reason?: string; questions?: unknown[] }
    return NextResponse.json({
      cached: true, insufficient: !!c.insufficient, reason: c.reason || '',
      questions: Array.isArray(c.questions) ? c.questions : [], notice: NOTICE
    })
  }

  let jobId = ''
  try {
    assertRateLimit(ctx.userId)
    jobId = await createJob(ctx.supabase, ctx.userId, 'textbook_quiz', hash, null, model)
    const { content, usage } = await callCodingPlan(ctx.config, {
      model, system: TEXTBOOK_QUIZ_SYSTEM, user: prompt, maxTokens: 3000
    })

    let result
    try { result = parseQuizResult(content, chapterTitle, count) }
    catch {
      throw new AiCallError(502, 'BAD_JSON', 'AI 返回的结构不是合法 JSON，未生成题目，请稍后重试')
    }

    await finishJob(ctx.supabase, jobId, result, usage)
    await logUsage(ctx.supabase, { userId: ctx.userId, jobId, kind: 'textbook_quiz', model, usage })

    if (result.insufficient) {
      return NextResponse.json({
        error: `课本材料不足，未生成任何题目：${result.reason}`,
        code: 'INSUFFICIENT_MATERIAL', insufficient: true,
        reason: result.reason, questions: [], notice: NOTICE
      }, { status: 422 })
    }
    return NextResponse.json({
      cached: false, insufficient: false, questions: result.questions,
      jobId, notice: NOTICE,
      ...(result.questions.length < count
        ? { partial: true, reason: `材料只够生成 ${result.questions.length} 道，未编造补足到 ${count} 道` }
        : {})
    })
  } catch (e: any) {
    if (jobId) {
      await failJob(ctx.supabase, jobId, e?.code || 'AI_ERROR', e?.message || '生成失败')
      await logUsage(ctx.supabase, {
        userId: ctx.userId, jobId, kind: 'textbook_quiz', model,
        usage: { request_tokens: 0, response_tokens: 0, total_tokens: 0 },
        status: 'failed', errorCode: e?.code
      })
    }
    // 401/403/404/429/超时/限流/网络错误都带中文提示，绝不静默降级成编题
    return aiErrorResponse(e)
  }
}
