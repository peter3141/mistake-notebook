/**
 * 浏览器端本地 OCR（Tesseract.js / WASM）。
 *
 * ★ 关键约束：识别全过程只在这台设备的浏览器 Worker 里跑，
 *   图片以 dataURL / Blob 直接传给本地 Worker，**不会上传图片到任何服务**；
 *   也不会调用 /api/ai/* 或 Coding Plan，因此 AI 总开关关闭、Key 未配置时照常可用，零费用。
 *
 * ★ 唯一会走网络的是「首次下载 OCR 引擎与语言包」（从公共 CDN 下载到本机缓存），
 *   下载的是程序/字典文件，不是用户图片。下载完成后写入浏览器缓存，后续离线也能识别。
 */

export interface LocalOcrLang { code: string; label: string; builtin: boolean; approxMB: number }

/** 默认只加载中文简体 + 英文；其他语言由用户在设置页按需勾选 */
export const LOCAL_OCR_LANGS: LocalOcrLang[] = [
  { code: 'chi_sim', label: '简体中文', builtin: true, approxMB: 12 },
  { code: 'eng', label: '英文', builtin: true, approxMB: 4 },
  { code: 'chi_tra', label: '繁体中文', builtin: false, approxMB: 12 },
  { code: 'jpn', label: '日文', builtin: false, approxMB: 14 },
  { code: 'kor', label: '韩文', builtin: false, approxMB: 13 },
  { code: 'fra', label: '法文', builtin: false, approxMB: 5 },
  { code: 'deu', label: '德文', builtin: false, approxMB: 5 },
  { code: 'spa', label: '西班牙文', builtin: false, approxMB: 5 }
]

export const DEFAULT_LOCAL_OCR_LANGS = 'chi_sim+eng'
export const LOCAL_OCR_STORAGE_KEY = 'local-ocr-langs'
export const LOCAL_OCR_TIMEOUT_MS = 120000

/** 首次加载体积说明（写进设置页与手册，避免用户以为页面卡死） */
export const LOCAL_OCR_DOWNLOAD = {
  core: '约 3–5 MB（WASM 引擎 + worker 脚本，一次性）',
  defaultLangs: '约 16 MB（简体中文 chi_sim ≈12MB + 英文 eng ≈4MB，gzip 传输）',
  extra: '每多勾一种语言约 4–14 MB，只在第一次使用那种语言时下载',
  cache: '下载后写入浏览器 IndexedDB / Cache Storage，之后不再重复下载；清浏览器数据或换设备/换浏览器会重新下载',
  offline: '引擎与语言包缓存完成后，识别本身可完全离线；弱网首次加载可能要等 30–60 秒，请保持页面打开'
}

export function readLocalOcrLangs(): string {
  try {
    const v = localStorage.getItem(LOCAL_OCR_STORAGE_KEY)
    if (!v) return DEFAULT_LOCAL_OCR_LANGS
    const codes = v.split('+').filter((c) => LOCAL_OCR_LANGS.some((l) => l.code === c))
    if (!codes.includes('chi_sim')) codes.unshift('chi_sim')
    if (!codes.includes('eng')) codes.push('eng')
    return codes.join('+')
  } catch { return DEFAULT_LOCAL_OCR_LANGS }
}

export function saveLocalOcrLangs(codes: string[]) {
  const next = [...new Set(['chi_sim', 'eng', ...codes])]
    .filter((c) => LOCAL_OCR_LANGS.some((l) => l.code === c))
  try { localStorage.setItem(LOCAL_OCR_STORAGE_KEY, next.join('+')) } catch {}
  return next.join('+')
}

export interface LocalOcrProgress { stage: string; progress: number }
export interface LocalOcrResult {
  text: string
  formulas: string[]
  lang: string
  confidence: number
  source: 'local'
  note: string
}

/** 从识别文本里挑出「疑似公式」的行；本地 OCR 无法生成 LaTeX，这里只做提示 */
function guessFormulas(text: string): string[] {
  const re = /[∑∫√±≤≥≠∞→αβγθπΔ]|[a-zA-Z]\s*\^\s*\d|\b\d+\s*\/\s*\d+\b|\\\(|\\\[/
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1 && l.length < 120 && re.test(l)).slice(0, 20)
}

/**
 * 对一张图片做本地识别。image 为 dataURL 或 Blob（已经压缩过，不会上传）。
 * 失败时抛错，调用方保留原图并允许手动录入，不阻塞录题。
 */
export async function runLocalOcr(
  image: string | Blob,
  opts: { langs?: string; onProgress?: (p: LocalOcrProgress) => void } = {}
): Promise<LocalOcrResult> {
  const langs = opts.langs || readLocalOcrLangs()
  opts.onProgress?.({ stage: '正在加载本地 OCR 引擎（首次需下载）', progress: 0.02 })

  // 动态 import：只有真正点了「本地 OCR」才加载这一大块代码，不影响首屏
  const T = await import('tesseract.js')
  const worker = await T.createWorker(langs, 1, {
    cacheMethod: 'write',
    gzip: true,
    logger: (m: any) => {
      const p = typeof m?.progress === 'number' ? m.progress : 0
      const stage = m?.status === 'loading language traineddata' ? '正在下载语言包（仅首次）'
        : m?.status === 'initializing tesseract' ? '正在初始化识别引擎'
          : m?.status === 'recognizing text' ? '正在识别图片文字'
            : String(m?.status || '正在准备')
      opts.onProgress?.({ stage, progress: Math.max(0.02, Math.min(0.98, p)) })
    }
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        '本地 OCR 超过 120 秒未完成。首次使用需要下载语言包，请检查网络后重试；也可以直接手动录入，原图已保留。'
      )), LOCAL_OCR_TIMEOUT_MS)
    })
    const ret: any = await Promise.race([worker.recognize(image as any), timeout])
    const text = String(ret?.data?.text || '').replace(/\n{3,}/g, '\n\n').trim()
    opts.onProgress?.({ stage: '识别完成', progress: 1 })
    return {
      text,
      formulas: guessFormulas(text),
      lang: langs,
      confidence: Number(ret?.data?.confidence || 0),
      source: 'local',
      note: '本地 OCR 输出的是纯文本，无法还原 LaTeX 公式；需要精确公式请用 AI OCR 或手动输入 KaTeX。'
    }
  } finally {
    if (timer) clearTimeout(timer)
    // 不 await，避免终止卡住时阻塞界面
    void worker.terminate().catch(() => {})
  }
}
