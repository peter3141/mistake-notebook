import type { AiConfig } from './config'

/** OpenAI 兼容 Chat/Completions 的消息内容（支持多模态 image_url） */
export type ChatContent = string | Array<
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
>

export interface CallResult {
  content: string
  usage: { request_tokens: number; response_tokens: number; total_tokens: number }
  attempts: number
}

export class AiCallError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// 简单限流：进程内滑动窗口（单实例够用；多实例生产可换 Supabase 表 / Upstash）
// ---------------------------------------------------------------------------
const RATE_PER_MINUTE = 10
const RATE_PER_DAY = 100
const buckets = new Map<string, { minute: number[]; day: number[] }>()

export function assertRateLimit(userId: string) {
  const now = Date.now()
  const b = buckets.get(userId) || { minute: [], day: [] }
  b.minute = b.minute.filter((t) => now - t < 60_000)
  b.day = b.day.filter((t) => now - t < 86_400_000)
  if (b.minute.length >= RATE_PER_MINUTE) {
    throw new AiCallError(429, 'RATE_LIMIT', '请求太密集，请稍后再试（每分钟最多 10 次）')
  }
  if (b.day.length >= RATE_PER_DAY) {
    throw new AiCallError(429, 'RATE_LIMIT', '今日 AI 调用次数已达上限（100 次），可在设置页查看用量或关闭 AI')
  }
  b.minute.push(now); b.day.push(now)
  buckets.set(userId, b)
}

// ---------------------------------------------------------------------------
// 错误码 → 面向用户的中文排查指引（对应手册「维护与排错」）
// ---------------------------------------------------------------------------
export function friendlyUpstreamError(status: number, body: string) {
  const lower = (body || '').toLowerCase()
  if (/not supported|unsupported model|model.*not found/i.test(lower) || status === 400) {
    return new AiCallError(400, 'MODEL_NOT_SUPPORTED',
      `模型 ID 不被 Coding Plan 支持或拼写有误。请检查 AI_MODEL / VISION_MODEL / OCR_MODEL 是否为精确版本（如 qwen3.7-plus，不是 qwen3.7），区分大小写且无空格。原始提示：${body.slice(0, 160)}`)
  }
  if (status === 401) return new AiCallError(401, 'INVALID_TOKEN',
    '401 invalid access token：Coding Plan 的 API Key 不对或已过期/被重置。请在百炼 Coding Plan 页面重新获取 sk-sp- 开头的专属 Key，更新 Vercel 环境变量 DASHSCOPE_CODING_API_KEY 后重新部署。')
  if (status === 403) return new AiCallError(403, 'INVALID_API_KEY',
    '403 invalid api-key：极可能误用了百炼通用按量计费的 Base URL 或普通 sk- Key。AI_BASE_URL 必须固定为 https://coding.dashscope.aliyuncs.com/v1，且 Key 必须是 sk-sp- 开头。')
  if (status === 404) return new AiCallError(404, 'BAD_BASE_URL',
    '404：Base URL 路径错误。Coding Plan 的 OpenAI 兼容地址是 https://coding.dashscope.aliyuncs.com/v1（末尾不要加 /chat/completions，代码会自动拼接）。')
  if (status === 429) return new AiCallError(429, 'QUOTA_EXCEEDED',
    '429 / quota exceeded：请求过于密集或 Coding Plan 套餐额度已用尽。周额度每周一 00:00（UTC+8）重置，月额度在订阅日重置；也可先关闭 AI 总开关避免继续消耗。')
  return new AiCallError(status || 502, 'UPSTREAM_ERROR', `AI 服务返回 ${status || '未知错误'}：${body.slice(0, 160)}`, status >= 500)
}

// ---------------------------------------------------------------------------
// 唯一的上游调用出口：只有这里会 fetch Coding Plan
// ---------------------------------------------------------------------------
export async function callCodingPlan(cfg: AiConfig, opts: {
  model: string
  system: string
  user: ChatContent
  maxTokens?: number
}): Promise<CallResult> {
  const url = `${cfg.baseUrl}/chat/completions`   // ★ 只用 Chat/Completions，禁止 Responses API
  const body = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user }
    ],
    temperature: 0.2,
    max_tokens: opts.maxTokens ?? 2000
  }

  let lastErr: unknown
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.key}`   // ★ Key 只在这里出现，永不进前端
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store'
      })
      const raw = await res.text()
      if (!res.ok) throw friendlyUpstreamError(res.status, raw)
      let json: any
      try { json = JSON.parse(raw) } catch { throw new AiCallError(502, 'BAD_JSON', 'AI 服务返回的不是合法 JSON，请稍后重试') }
      const content = json?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new AiCallError(502, 'EMPTY_CONTENT', 'AI 服务未返回内容，请稍后重试')
      const u = json?.usage || {}
      return {
        content,
        usage: {
          request_tokens: Number(u.prompt_tokens || 0),
          response_tokens: Number(u.completion_tokens || 0),
          total_tokens: Number(u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0))
        },
        attempts: attempt + 1
      }
    } catch (e) {
      clearTimeout(timer)
      if (e instanceof AiCallError) {
        lastErr = e
        if (!e.retryable || attempt >= cfg.maxRetries) throw e   // 4xx / 429 不重试；重试有上限
      } else if ((e as Error)?.name === 'AbortError') {
        lastErr = new AiCallError(504, 'TIMEOUT', `AI 请求超时（${cfg.timeoutMs}ms），请稍后重试`, true)
        if (attempt >= cfg.maxRetries) throw lastErr
      } else {
        lastErr = new AiCallError(502, 'NETWORK', `无法连接 AI 服务：${(e as Error)?.message || '网络错误'}`, true)
        if (attempt >= cfg.maxRetries) throw lastErr
      }
      continue
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('AI 调用失败')
}
