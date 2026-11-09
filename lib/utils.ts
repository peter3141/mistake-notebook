import clsx, { type ClassValue } from 'clsx'
import katex from 'katex'

export const cn = (...v: ClassValue[]) => clsx(v)

export const todayISO = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD（本地时区）
export const toDateInput = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toLocaleDateString('sv-SE'))
export const addDays = (base: Date | string, days: number) => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—')
export const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

/** 艾宾浩斯：根据结果计算下次复习间隔 */
export function nextInterval(current: number, intervals: number[], result: 'again' | 'fuzzy' | 'mastered') {
  const sorted = [...(intervals?.length ? intervals : [1, 2, 4, 7, 15, 30])].sort((a, b) => a - b)
  if (result === 'again') return sorted[0]
  if (result === 'fuzzy') return current || sorted[0]
  const idx = sorted.findIndex((n) => n > current)
  return idx === -1 ? sorted[sorted.length - 1] * 2 : sorted[idx]
}

/** SHA-256（Web Crypto，浏览器与 Node 18+ 均可用）——用于 AI 结果缓存 key */
export async function sha256(input: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 富文本白名单清洗：只保留排版需要的标签，去掉脚本与事件属性 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'a', 'span', 'div', 'hr'
])
export function sanitizeHtml(html: string) {
  if (!html) return ''
  let out = html.replace(/<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  out = out.replace(/<\s*\/?\s*([a-zA-Z0-9]+)([^>]*)>/g, (full, tag: string, attrs: string) => {
    const t = tag.toLowerCase()
    if (!ALLOWED_TAGS.has(t)) return ''
    const clean = attrs
      .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
    // img 只允许 https / data:image / 本站签名 URL；避免外链追踪
    if (t === 'img' || t === 'a') {
      if (/src\s*=\s*["']?(?!https:\/\/|data:image\/|\/)/i.test(clean)) return full.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    }
    return `<${t}${clean}>`
  })
  return out
}

/** 把 $...$ / $$...$$ 渲染成 KaTeX HTML（不可信内容请先 sanitizeHtml） */
export function renderMath(html: string) {
  if (!html) return ''
  return html
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
      try { return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }) } catch { return `<code>${tex}</code>` }
    })
    .replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => {
      try { return katex.renderToString(tex.trim(), { throwOnError: false }) } catch { return `<code>${tex}</code>` }
    })
}

/** 浏览器端图片压缩：最长边 1600px、webp 质量 0.8；失败则原样返回 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<File> {
  if (typeof window === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

export function downloadBlob(filename: string, content: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

/** CSV 转义 */
export const csvCell = (v: unknown) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join('|') : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(rows: Record<string, unknown>[], headers: { key: string; label: string }[]) {
  const head = headers.map((h) => csvCell(h.label)).join(',')
  const body = rows.map((r) => headers.map((h) => csvCell(r[h.key])).join(',')).join('\r\n')
  return '\ufeff' + head + '\r\n' + body
}
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const parseLine = (line: string) => {
    const cells: string[] = []; let cur = ''; let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted }
      else if (c === ',' && !quoted) { cells.push(cur); cur = '' }
      else cur += c
    }
    cells.push(cur); return cells
  }
  const headers = parseLine(lines[0])
  return lines.slice(1).map((l) => {
    const cells = parseLine(l)
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]))
  })
}

export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}
