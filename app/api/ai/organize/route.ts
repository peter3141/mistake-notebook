import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAi, aiErrorResponse } from '@/lib/ai/guard'
import { assertRateLimit, callCodingPlan, type ChatContent } from '@/lib/ai/coding-plan'
import { findCached, createJob, finishJob, failJob, logUsage } from '@/lib/ai/job'
import { ORGANIZE_SYSTEM, buildOrganizePrompt, parseJsonLoose, normalizeOrganizeResult, MAX_IMAGE_BASE64_CHARS } from '@/lib/ai/prompts'
import { sha256 } from '@/lib/utils'
import { BUCKET } from '@/lib/images/server'
import type { AiKind, AiOrganizeResult } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  mistakeId: z.string().uuid().optional(),
  title: z.string().max(300).optional(),
  content: z.string().max(20000).optional(),
  answer: z.string().max(5000).optional(),
  analysis: z.string().max(5000).optional(),
  images: z.array(z.string().max(MAX_IMAGE_BASE64_CHARS)).max(4).optional(),
  /** v4：整题原图的 Storage 路径；服务端校验归属后自己从私有桶读取，不要求用户本地路径 */
  storagePaths: z.array(z.string().max(500)).max(4).optional(),
  customTemplate: z.string().max(3000).optional(),
  batch: z.boolean().optional()
})

/**
 * ★ AI 整理：只「返回」结构化结果，绝不写 mistakes 表。
 * 前端必须预览 + 用户点「确认应用」后，才由前端发普通 PATCH 写库（并可回滚历史版本）。
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}))
  // ① 无论 body 是否合法，先过服务端 AI 开关；关闭时零外部调用、零费用
  let ctx
  try { ctx = await requireAi(raw?.batch === true ? 'batch' : 'organize') }
  catch (e) { return aiErrorResponse(e) }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '参数不合法', code: 'BAD_INPUT', detail: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data
  const images = (body.images || []).filter((u) => /^(data:image\/|https:\/\/)/.test(u))
  // ★ v4 图片理解：从 Storage 取图，校验路径归属，不读用户本地文件
  for (const p of body.storagePaths || []) {
    if (!p.startsWith(`${ctx.userId}/`) || p.includes('..')) {
      return NextResponse.json({ error: '图片路径不属于当前用户', code: 'FORBIDDEN_PATH' }, { status: 403 })
    }
    const { data: rec } = await ctx.supabase.from('mistake_images').select('id')
      .eq('storage_path', p).eq('user_id', ctx.userId).maybeSingle()
    if (!rec) return NextResponse.json({ error: '图片不存在或无权访问', code: 'FORBIDDEN_PATH' }, { status: 403 })
    const { data: blob, error: dlErr } = await ctx.supabase.storage.from(BUCKET).download(p)
    if (dlErr || !blob) {
      return NextResponse.json({ error: '读取图片失败，请检查网络或存储配置（原图已保留）' }, { status: 502 })
    }
    const buf = Buffer.from(await blob.arrayBuffer())
    if (buf.byteLength > 4 * 1024 * 1024) {
      return NextResponse.json({ error: '图片超过 4MB，无法送进模型，请先压缩或裁剪' }, { status: 413 })
    }
    images.push(`data:${blob.type || 'image/webp'};base64,${buf.toString('base64')}`)
  }
  const prompt = buildOrganizePrompt({
    title: body.title, content: body.content, answer: body.answer, analysis: body.analysis,
    hasImages: images.length > 0, customTemplate: body.customTemplate || ctx.settings.prompt_template
  })
  if (prompt.length > 12000) return NextResponse.json({ error: '输入内容过长，请精简后再试', code: 'INPUT_TOO_LONG' }, { status: 413 })

  const kind: AiKind = body.batch ? 'batch' : 'organize'
  const model = images.length ? ctx.config.visionModel : ctx.config.textModel
  const hash = await sha256(`${kind}|${model}|${prompt}|${(body.storagePaths || []).join(',')}|${images.length}|${images.map((s) => s.slice(-128)).join(',')}`)

  // ② 缓存命中直接返回，不调用 Coding Plan
  const cached = await findCached(ctx.supabase, ctx.userId, kind, hash)
  if (cached) return NextResponse.json({ cached: true, result: cached as AiOrganizeResult, jobId: null })

  let jobId = ''
  try {
    assertRateLimit(ctx.userId)                       // ③ 限流
    jobId = await createJob(ctx.supabase, ctx.userId, kind, hash, body.mistakeId, model)

    const userContent: ChatContent = images.length
      ? [
          { type: 'text' as const, text: prompt },
          ...images.map((u) => ({ type: 'image_url' as const, image_url: { url: u } }))
        ]
      : prompt
    const { content, usage } = await callCodingPlan(ctx.config, { model, system: ORGANIZE_SYSTEM, user: userContent })
    const result = normalizeOrganizeResult(parseJsonLoose<Partial<AiOrganizeResult>>(content))

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
