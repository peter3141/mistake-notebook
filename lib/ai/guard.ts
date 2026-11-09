import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAiConfig, type AiConfig } from './config'
import type { AiCapability, UserSettings } from '@/types'

/**
 * ★ 服务端 AI 开关校验中间件（验收 16/17/19/21 的核心）
 * 每个 /api/ai/{organize,ocr,similar} 路由的「第一行业务代码」都必须调用 requireAi()。
 * 判定全部发生在「发起任何外部请求之前」→ 关闭开关后 100% 不产生 AI 调用与费用。
 * v2：新增 schedule(AI日程解析) / note(AI笔记总结) / plan(AI规划预留) 三个能力，
 *     同样走「总开关 → 子开关 → 配置」三道校验，关闭总开关后一律 403「AI功能已关闭」。
 */
export class AiGuardError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export const DEFAULT_AI_SETTINGS = {
  ai_enabled: false,            // 总开关默认关闭 = 零 AI 费用
  ai_organize: true,
  ai_ocr: true,
  ai_similar: true,
  ai_batch: true,
  ai_schedule_parse: true,      // v2：AI 自然语言创建日程
  ai_note_summary: true,        // v2：AI 笔记总结
  ai_plan: false,               // v2：AI 规划预留，默认关
  ai_text_model: 'qwen3.7-plus',
  ai_vision_model: 'qwen3.7-plus'
}

type AiFlag = 'ai_enabled' | 'ai_organize' | 'ai_ocr' | 'ai_similar' | 'ai_batch'
  | 'ai_schedule_parse' | 'ai_note_summary' | 'ai_plan'
const CAP_FIELD: Record<AiCapability, AiFlag> = {
  organize: 'ai_organize', ocr: 'ai_ocr', similar: 'ai_similar', batch: 'ai_batch',
  schedule: 'ai_schedule_parse', note: 'ai_note_summary', plan: 'ai_plan'
}
const CAP_LABEL: Record<AiCapability, string> = {
  organize: 'AI整理错题', ocr: 'OCR/图片识题', similar: '相似题推荐', batch: 'AI批量整理',
  schedule: 'AI日程解析', note: 'AI笔记总结', plan: 'AI规划'
}

export async function readSettings(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data } = await supabase
    .from('user_settings')
    .select('ai_enabled, ai_organize, ai_ocr, ai_similar, ai_batch, ai_schedule_parse, ai_note_summary, ai_plan, ai_text_model, ai_vision_model, prompt_template, review_intervals')
    .eq('user_id', userId).maybeSingle()
  return { ...DEFAULT_AI_SETTINGS, ...(data || {}) } as Pick<UserSettings,
    'ai_enabled' | 'ai_organize' | 'ai_ocr' | 'ai_similar' | 'ai_batch' | 'ai_schedule_parse' | 'ai_note_summary' | 'ai_plan'
    | 'ai_text_model' | 'ai_vision_model' | 'prompt_template' | 'review_intervals'>
}

export interface AiContext {
  userId: string
  supabase: ReturnType<typeof createClient>
  settings: Awaited<ReturnType<typeof readSettings>>
  config: AiConfig
  capability: AiCapability
}

export async function requireAi(capability: AiCapability): Promise<AiContext> {
  const supabase = createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) throw new AiGuardError(401, 'UNAUTHORIZED', '请先登录')

  const settings = await readSettings(supabase, user.id)

  // ① 总开关：最高优先级，先于一切配置读取与外部调用
  if (!settings.ai_enabled) {
    throw new AiGuardError(403, 'AI_DISABLED', 'AI功能已关闭')
  }
  // ② 子开关：总开关闭时子开关一律失效（上面已 return）
  if (!settings[CAP_FIELD[capability]]) {
    throw new AiGuardError(403, 'AI_CAPABILITY_DISABLED', `${CAP_LABEL[capability]}已关闭`)
  }
  // ③ 服务端环境变量（不合法 / 未配置 → 明确提示，不白屏、不影响非 AI 功能）
  const config = getAiConfig()
  if (!config.configured) {
    throw new AiGuardError(503, 'AI_NOT_CONFIGURED', `AI未配置：${config.issues.join('；')}`)
  }
  return { userId: user.id, supabase, settings, config, capability }
}

/** 统一错误响应：只回错误码与中文提示，绝不回显 Key 或完整响应体 */
export function aiErrorResponse(err: unknown) {
  if (err instanceof AiGuardError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  // AiCallError（上游 401/403/404/429/超时等）也带上状态码与错误码
  if (err && typeof err === 'object' && 'status' in err && 'code' in err) {
    const e = err as { status: number; code: string; message: string }
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status || 500 })
  }
  const msg = err instanceof Error ? err.message : '未知错误'
  // 任何情况下都做一次脱敏，防止上游报错里带出 sk-sp-xxx
  const safe = msg.replace(/sk-sp-[A-Za-z0-9_\-]+/g, 'sk-sp-***').replace(/sk-[A-Za-z0-9_\-]{12,}/g, 'sk-***')
  return NextResponse.json({ error: safe, code: 'AI_ERROR' }, { status: 500 })
}
