import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAi, aiErrorResponse } from '@/lib/ai/guard'
import { assertRateLimit, callCodingPlan } from '@/lib/ai/coding-plan'
import { findCached, createJob, finishJob, failJob, logUsage } from '@/lib/ai/job'
import { SIMILAR_SYSTEM, buildSimilarPrompt, parseJsonLoose } from '@/lib/ai/prompts'
import { sha256 } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  mistakeId: z.string().uuid().optional(),
  title: z.string().max(300).optional(),
  content: z.string().max(12000).optional(),
  knowledgePoints: z.array(z.string().max(80)).max(20).optional()
})

/** 相似题推荐：前端必须固定标注「AI生成，需核对」，不得当作标准题使用或参与组卷 */
export async function POST(req: Request) {
  let ctx
  try { ctx = await requireAi('similar') }
  catch (e) { return aiErrorResponse(e) }

  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法', code: 'BAD_INPUT' }, { status: 400 })
  const b = parsed.data
  const prompt = buildSimilarPrompt(b)
  const model = ctx.config.textModel
  const hash = await sha256(`similar|${model}|${prompt}`)
  const cached = await findCached(ctx.supabase, ctx.userId, 'similar', hash)
  if (cached) return NextResponse.json({ cached: true, questions: (cached as any).questions || [], jobId: null })

  let jobId = ''
  try {
    assertRateLimit(ctx.userId)
    jobId = await createJob(ctx.supabase, ctx.userId, 'similar', hash, b.mistakeId, model)
    const { content, usage } = await callCodingPlan(ctx.config, { model, system: SIMILAR_SYSTEM, user: prompt })
    const j = parseJsonLoose<{ questions?: string[] }>(content)
    const questions = (Array.isArray(j.questions) ? j.questions : []).map(String).slice(0, 3)
    const result = { questions }
    await finishJob(ctx.supabase, jobId, result, usage)
    await logUsage(ctx.supabase, { userId: ctx.userId, jobId, kind: 'similar', model, usage })
    return NextResponse.json({ cached: false, questions, jobId, notice: 'AI生成，需核对' })
  } catch (e: any) {
    if (jobId) {
      await failJob(ctx.supabase, jobId, e?.code || 'AI_ERROR', e?.message || '生成失败')
      await logUsage(ctx.supabase, {
        userId: ctx.userId, jobId, kind: 'similar', model,
        usage: { request_tokens: 0, response_tokens: 0, total_tokens: 0 }, status: 'failed', errorCode: e?.code
      })
    }
    return aiErrorResponse(e)
  }
}
