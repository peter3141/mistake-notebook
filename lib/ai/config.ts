/**
 * 阿里云百炼 Coding Plan 配置自检（★ 仅服务端 import）
 * 绝不把 key 输出到响应、日志或前端。
 */
export const CODING_PLAN_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1'

/** Coding Plan 已知支持的模型（官方文档 2026-11）。新增模型时可在此追加。 */
export const KNOWN_TEXT_MODELS = [
  'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus', 'qwen3-max-2026-01-23',
  'glm-5', 'glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'qwen3-coder-next', 'qwen3-coder-plus'
]
/** 明确支持图片理解 / 视觉的模型 —— OCR 与图片识题只能用这些 */
export const KNOWN_VISION_MODELS = ['qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus', 'kimi-k2.5']

export interface AiConfig {
  baseUrl: string
  key: string
  textModel: string
  visionModel: string
  ocrModel: string
  timeoutMs: number
  maxRetries: number
  configured: boolean
  issues: string[]    // 阻塞：configured = false
  warnings: string[]  // 仅提示
}

const clean = (v?: string | null) => (v ?? '').trim()

export function getAiConfig(): AiConfig {
  const baseRaw = clean(process.env.AI_BASE_URL)
  const baseUrl = baseRaw.replace(/\/+$/, '')
  const key = clean(process.env.DASHSCOPE_CODING_API_KEY)
  const textModel = clean(process.env.AI_MODEL) || 'qwen3.7-plus'
  const visionModel = clean(process.env.VISION_MODEL) || textModel
  const ocrModel = clean(process.env.OCR_MODEL) || visionModel
  const timeoutMs = Number(clean(process.env.AI_TIMEOUT_MS) || '30000')
  const maxRetries = Math.min(2, Math.max(0, Number(clean(process.env.AI_MAX_RETRIES) || '1')))

  const issues: string[] = []
  const warnings: string[] = []

  // —— Base URL：Coding Plan 与通用按量计费接口不互通 ——
  if (!baseRaw) {
    issues.push('AI_BASE_URL 未配置')
  } else if (baseUrl !== CODING_PLAN_BASE_URL) {
    if (/maas\.aliyuncs\.com|compatible-mode|dashscope\.aliyuncs\.com/i.test(baseUrl)) {
      issues.push('AI_BASE_URL 是百炼通用按量计费地址，与 Coding Plan 不互通，会导致鉴权失败或额外扣费；必须改为 https://coding.dashscope.aliyuncs.com/v1')
    } else {
      issues.push(`AI_BASE_URL 必须是 ${CODING_PLAN_BASE_URL}（Chat/Completions 协议）`)
    }
  }

  // —— API Key：必须 sk-sp- 开头 ——
  if (!key) {
    issues.push('DASHSCOPE_CODING_API_KEY 未配置')
  } else if (!key.startsWith('sk-sp-')) {
    issues.push('DASHSCOPE_CODING_API_KEY 必须以 sk-sp- 开头（Coding Plan 专属 Key）；普通 sk- 通用 Key 不互通')
  }

  // —— 模型 ID：精确、无空格、区分大小写 ——
  for (const [label, m] of [['AI_MODEL', textModel], ['VISION_MODEL', visionModel], ['OCR_MODEL', ocrModel]] as const) {
    if (!m || /\s/.test(m)) issues.push(`${label} 不能为空且不能含空格：${m || '(空)'}`)
  }
  if (textModel && !KNOWN_TEXT_MODELS.includes(textModel)) {
    warnings.push(`AI_MODEL=${textModel} 不在已知列表，请确认 Coding Plan 支持该精确模型 ID`)
  }
  for (const [label, m] of [['VISION_MODEL', visionModel], ['OCR_MODEL', ocrModel]] as const) {
    if (m && !KNOWN_VISION_MODELS.includes(m)) {
      issues.push(`${label}=${m} 未标注支持图片理解；视觉/OCR 请使用 qwen3.7-plus / qwen3.6-plus / kimi-k2.5（可在 lib/ai/config.ts 的 KNOWN_VISION_MODELS 追加新模型）`)
    }
  }

  return {
    baseUrl: baseUrl || CODING_PLAN_BASE_URL, key, textModel, visionModel, ocrModel,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,
    maxRetries, configured: issues.length === 0, issues, warnings
  }
}

/** 给前端看的、不含任何密钥的安全摘要 */
export function publicAiSummary() {
  const c = getAiConfig()
  return {
    configured: c.configured,
    configIssues: c.issues,       // 只描述缺什么，不含 key 内容
    warnings: c.warnings,
    textModel: c.textModel,
    visionModel: c.visionModel,
    ocrModel: c.ocrModel,
    baseUrl: c.baseUrl
  }
}
