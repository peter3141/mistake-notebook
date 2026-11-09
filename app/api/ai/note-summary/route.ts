import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAi, aiErrorResponse } from '@/lib/ai/guard'
import { assertRateLimit, callCodingPlan } from '@/lib/ai/coding-plan'
import { findCached, createJob, finishJob, failJob, logUsage } from '@/lib/ai/job'
import { NOTE_SYSTEM, buildNotePrompt, normalizeNoteResult } from '@/lib/ai/prompts-v2'
import { parseJsonLoose } from '@/lib/ai/prompts'
import { sha256 } from '@/lib/utils'
import type { AiKind, NoteSummaryResult } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  noteId: z.string().uuid().optional(),
  title: z.string().max(300).optional(),
  content: z.string().min(1).max(20000),
  customTemplate: z.string().max(1500).optional()
})

/**
 * ★ v2：AI 笔记总结 —— 只返回预览，绝不写 notes 表。
 * 用户点「确认应用」后填入编辑区，再点「保存」才写库（笔记触发器自动留历史版本，可回滚）。
 * 第一行即 requireAi('note')：关闭总开关或 ai_note_summary 子开关 → 403，零 API 调用与费用。
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}))
  let ctx
  try { ctx = await requireAi('note') }
  catch (e) { return aiErrorResponse(e) }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '参数不合法', code: 'BAD_INPUT' }, { status: 400 })
  const body = parsed.data
  const prompt = buildNotePrompt(body.title || '', body.content, body.customTemplate)
  if (prompt.length > 12000) return NextResponse.json({ error: '笔记内容过长，请精简后再试', code: 'INPUT_TOO_LONG' }, { status: 413 })

  const kind: AiKind = 'note'
  const model = ctx.config.textModel       // 纯文本任务
  const hash = await sha256(`${kind}|${model}|${prompt}`)
  const cached = await findCached(ctx.supabase, ctx.userId, kind, hash)
  if (cached) return NextResponse.json({ cached: true, result: cached as NoteSummaryResult, jobId: null })

  let jobId = ''
  try {
    assertRateLimit(ctx.userId)
    jobId = await createJob(ctx.supabase, ctx.userId, kind, hash, null, model)
    const { content, usage } = await callCodingPlan(ctx.config, {
      model, system: NOTE_SYSTEM, user: prompt, maxTokens: 1000
    })
    const result = normalizeNoteResult(parseJsonLoose<any>(content))
    await finishJob(ctx.supabase, jobId, result, usage)
    await logUsage(ctx.supabase, { userId: ctx.userId, jobId, kind, model, usage })
    return NextResponse.json({ cached: false, result, jobId })
  } catch (e: any) {
    if (jobId) {
      await failJob(ctx.supabase, jobId, e?.code || 'AI_ERROR', e?.message || 'AI 调用失败')
      await logUsage(ctx.supabase, {
        userId: ctx.userId, jobId, kind, model,
        usage: { request_tokens: 0, response_tokens: 0, total_tokens: 0 },
        status: 'failed', errorCode: e?.code || 'AI_ERROR'
      })
    }
    return aiErrorResponse(e)
  }
}
