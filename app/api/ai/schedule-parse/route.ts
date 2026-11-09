import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAi, aiErrorResponse } from '@/lib/ai/guard'
import { assertRateLimit, callCodingPlan } from '@/lib/ai/coding-plan'
import { findCached, createJob, finishJob, failJob, logUsage } from '@/lib/ai/job'
import { SCHEDULE_SYSTEM, buildSchedulePrompt, normalizeScheduleResult, MAX_SCHEDULE_TEXT_CHARS } from '@/lib/ai/prompts-v2'
import { parseJsonLoose } from '@/lib/ai/prompts'
import { sha256, stripHtml } from '@/lib/utils'
import type { AiKind, ScheduleParseResult } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  text: z.string().min(1).max(MAX_SCHEDULE_TEXT_CHARS),
  now: z.string().max(60).optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional()
})

/**
 * ★ v2：AI 自然语言创建日程 —— 只返回结构化预览，绝不写 schedules 表。
 * 前端必须展示预览、用户点「确认应用并创建」后，才由 confirmParsedSchedule() 写库。
 * 第一行即 requireAi('schedule')：总开关 / ai_schedule_parse 子开关 / 配置任一不通过 → 零外部调用。
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}))
  let ctx
  try { ctx = await requireAi('schedule') }
  catch (e) { return aiErrorResponse(e) }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '参数不合法（请提供 1–1000 字的日程描述）', code: 'BAD_INPUT' }, { status: 400 })
  const { text, now, timezoneOffsetMinutes } = parsed.data
  const nowISO = now || new Date().toISOString()
  const prompt = buildSchedulePrompt(stripHtml(text), nowISO, timezoneOffsetMinutes ?? 480)
  if (prompt.length > 4000) return NextResponse.json({ error: '输入内容过长', code: 'INPUT_TOO_LONG' }, { status: 413 })

  const kind: AiKind = 'schedule'
  const model = ctx.config.textModel        // 纯文本任务，用 AI_MODEL，不调用视觉模型
  const hash = await sha256(`${kind}|${model}|${prompt}`)
  const cached = await findCached(ctx.supabase, ctx.userId, kind, hash)
  if (cached) return NextResponse.json({ cached: true, result: cached as ScheduleParseResult, jobId: null })

  let jobId = ''
  try {
    assertRateLimit(ctx.userId)             // 限流：每分钟 10 次 / 每天 100 次
    jobId = await createJob(ctx.supabase, ctx.userId, kind, hash, null, model)
    const { content, usage } = await callCodingPlan(ctx.config, {
      model, system: SCHEDULE_SYSTEM, user: prompt, maxTokens: 800
    })
    const result = normalizeScheduleResult(parseJsonLoose<any>(content))
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
