import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAi, aiErrorResponse } from '@/lib/ai/guard'
import { assertRateLimit, callCodingPlan, type ChatContent } from '@/lib/ai/coding-plan'
import { findCached, createJob, finishJob, failJob, logUsage } from '@/lib/ai/job'
import { OCR_SYSTEM, buildOcrPrompt, parseJsonLoose, MAX_IMAGE_BASE64_CHARS } from '@/lib/ai/prompts'
import { sha256 } from '@/lib/utils'
import { BUCKET } from '@/lib/images/server'
import type { OcrResult } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  /** 兼容 v1：前端把当前图片 dataUrl 直接传来（只用于「刚选中的图」，不落库） */
  image: z.string().min(20).max(MAX_IMAGE_BASE64_CHARS).optional(),
  /** v4 推荐：整题原图的 Storage 路径。服务端校验归属后自己从 Storage 读取 */
  storagePath: z.string().max(500).optional(),
  mistakeId: z.string().uuid().optional(),
  imageId: z.string().uuid().optional()
}).refine((v) => !!v.image || !!v.storagePath, { message: '请提供 image 或 storagePath' })

/** 结构化 OCR 输出；图形描述必须标注「AI 描述，仅供参考」，打印默认不输出 */
interface FullPageOcr {
  text: string
  options: string
  formulas: string
  figureDescription: string
  confidence: number | null
}

const STRUCTURED_HINT = `
请严格输出一个 JSON 对象，不要任何额外解释，字段如下：
{
  "text": "题干文字（含选项，保持原有分行）",
  "options": "选择题选项文字，没有则空字符串",
  "formulas": "识别到的公式文本，多个用空格分隔",
  "figureDescription": "若有几何图形/函数图像/表格，用中文描述其内容；没有则空字符串。此描述只是参考，绝不能替代原图",
  "confidence": 0.0 到 1.0 之间的整体置信度数字，无法判断则填 null
}
`

/**
 * ★ OCR（Coding Plan 视觉模型 / Chat Completions）
 *  - 判定顺序：登录 → AI 总开关 → OCR 子开关 → Key/BaseURL 配置 → 限流 → 缓存 → 外部调用
 *  - v4：支持 storagePath，服务端从私有桶读取，校验图片归属，不要求用户本地路径
 *  - 结果只返回前端预览，用户点「确认应用」才写题干；失败保留原图、允许重试
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}))
  let ctx
  try { ctx = await requireAi('ocr') }
  catch (e) { return aiErrorResponse(e) }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '参数不合法或图片过大（≤4MB）', code: 'BAD_INPUT' }, { status: 400 })
  const { mistakeId, imageId } = parsed.data
  let { image, storagePath } = parsed.data

  // ★ v4 归属校验：storagePath 必须是当前用户目录下的、且数据库里登记过的图片，
  //   防止伪造路径读取别人的图。RLS 之外再做一次显式校验。
  let ownedImageId: string | null = imageId || null
  if (storagePath) {
    if (!storagePath.startsWith(`${ctx.userId}/`) || storagePath.includes('..')) {
      return NextResponse.json({ error: '图片路径不属于当前用户', code: 'FORBIDDEN_PATH' }, { status: 403 })
    }
    const { data: rec } = await ctx.supabase.from('mistake_images')
      .select('id, storage_path, image_role').eq('storage_path', storagePath).eq('user_id', ctx.userId).maybeSingle()
    if (!rec) {
      return NextResponse.json({ error: '图片不存在或无权访问（请确认已上传成功）', code: 'FORBIDDEN_PATH' }, { status: 403 })
    }
    ownedImageId = rec.id
    // 服务端从 Storage 读图 → 转成模型需要的 data URL（仅内存传输，不写数据库、不写日志）
    const { data: blob, error: dlErr } = await ctx.supabase.storage.from(BUCKET).download(storagePath)
    if (dlErr || !blob) {
      return NextResponse.json({ error: '读取图片失败，请检查网络或存储配置（原图已保留，可重试）', code: 'STORAGE_READ_FAILED' }, { status: 502 })
    }
    const buf = Buffer.from(await blob.arrayBuffer())
    if (buf.byteLength > 4 * 1024 * 1024) {
      return NextResponse.json({ error: '图片超过 4MB，无法送进模型；请先压缩或裁剪' }, { status: 413 })
    }
    const mime = blob.type || 'image/webp'
    image = `data:${mime};base64,${buf.toString('base64')}`
  }

  if (!image || !/^(data:image\/|https:\/\/)/.test(image)) {
    return NextResponse.json({ error: '图片格式不合法', code: 'BAD_INPUT' }, { status: 400 })
  }

  const model = ctx.config.ocrModel
  const prompt = buildOcrPrompt() + STRUCTURED_HINT
  // 缓存键：同一张 Storage 图 + 同一模型只调一次；dataUrl 场景按内容指纹
  const hash = await sha256(`ocr-v4|${model}|${storagePath || image.slice(-512)}`)
  const cached = await findCached(ctx.supabase, ctx.userId, 'ocr', hash)
  if (cached) return NextResponse.json({ cached: true, result: cached as OcrResult, full: toFull(cached), jobId: null, imageId: ownedImageId })

  let jobId = ''
  try {
    assertRateLimit(ctx.userId)
    jobId = await createJob(ctx.supabase, ctx.userId, 'ocr', hash, mistakeId, model)
    const userContent: ChatContent = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: image } }
    ]
    const { content, usage } = await callCodingPlan(ctx.config, { model, system: OCR_SYSTEM, user: userContent, maxTokens: 2500 })
    const p = parseJsonLoose<Record<string, unknown>>(content)
    const full: FullPageOcr = {
      text: String(p.text || ''),
      options: String(p.options || ''),
      formulas: String(p.formulas || (Array.isArray(p.formulas) ? (p.formulas as string[]).join(' ') : '')),
      figureDescription: String(p.figureDescription || p.figure_description || ''),
      confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : null
    }
    // 兼容 v1 的 OcrResult（MistakeForm 现有预览用）
    const result: OcrResult = {
      text: [full.text, full.options].filter(Boolean).join('\n'),
      formulas: full.formulas ? full.formulas.split(/\s{2,}|\n/).filter(Boolean) : [],
      rawText: content.slice(0, 200)
    }
    await finishJob(ctx.supabase, jobId, result, usage)
    await logUsage(ctx.supabase, { userId: ctx.userId, jobId, kind: 'ocr', model, usage })

    // OCR 结果是独立记录，不覆盖原图
    const { data: oj } = await ctx.supabase.from('ocr_jobs').insert({
      user_id: ctx.userId, mistake_id: mistakeId || null,
      image_id: ownedImageId, image_path: storagePath || null,
      status: 'succeeded', model: model || null, raw_text: full.text,
      options: full.options, formulas: full.formulas,
      figure_description: full.figureDescription,
      is_ai_description: !!full.figureDescription,
      confidence: full.confidence, source: 'ai',
      result_json: { ...full, legacy: result } as any,
      completed_at: new Date().toISOString()
    }).select('id').single()
    if (ownedImageId && oj?.id) {
      await ctx.supabase.from('mistake_images').update({ ocr_job_id: oj.id }).eq('id', ownedImageId)
    }
    return NextResponse.json({ cached: false, result, full, jobId, imageId: ownedImageId })
  } catch (e: any) {
    if (jobId) {
      await failJob(ctx.supabase, jobId, e?.code || 'OCR_ERROR', e?.message || 'OCR 失败')
      await logUsage(ctx.supabase, {
        userId: ctx.userId, jobId, kind: 'ocr', model,
        usage: { request_tokens: 0, response_tokens: 0, total_tokens: 0 }, status: 'failed', errorCode: e?.code
      })
    }
    await ctx.supabase.from('ocr_jobs').insert({
      user_id: ctx.userId, mistake_id: mistakeId || null, image_id: ownedImageId,
      image_path: storagePath || null,
      status: 'failed', model, error: (e?.message || 'OCR 失败').slice(0, 400), source: 'ai'
    })
    // 失败不删原图、不删 Storage 记录；前端可「重试 OCR」且不重复上传
    return aiErrorResponse(e)
  }
}

function toFull(cached: unknown): FullPageOcr {
  const c = cached as any
  return {
    text: String(c?.text || c?.rawText || ''),
    options: '', formulas: Array.isArray(c?.formulas) ? c.formulas.join(' ') : '',
    figureDescription: '', confidence: null
  }
}
