/**
 * 导出专用的极简 HTML → 纯文本 / 行结构转换。
 * 只用于 Word / Anki 导出，不参与页面渲染，也不执行任何 HTML。
 */

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&ldquo;': '“', '&rdquo;': '”', '&mdash;': '—', '&hellip;': '…', '&times;': '×', '&divide;': '÷'
}

function decode(s: string) {
  return s.replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/** 把富文本 HTML 拆成若干「行」，用于 Word 段落 */
export function htmlToLines(html?: string | null): string[] {
  if (!html) return []
  let s = String(html)
  // 块级标签 → 换行；列表项 → 前缀；表格单元格 → 制表符
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n')
  s = s.replace(/<\/\s*(p|div|h[1-6]|li|tr|blockquote|pre|table|ul|ol)\s*>/gi, '\n')
  s = s.replace(/<\s*li[^>]*>/gi, '• ')
  s = s.replace(/<\/\s*t[dh]\s*>/gi, '\t')
  s = s.replace(/<[^>]+>/g, '')
  s = decode(s)
  return s.split('\n').map((l) => l.replace(/\r/g, '').replace(/[ \t]+$/g, '').trim()).filter((l) => l.length > 0)
}

export function htmlToPlain(html?: string | null): string {
  return htmlToLines(html).join('\n')
}

/** Anki TSV 单元格：不能有制表符/换行，字段内用 <br> 表示换行 */
export function tsvCell(s: string): string {
  return String(s ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Anki HTML 字段：转义后把换行变成 <br> */
export function ankiHtml(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>')
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 按扩展名推断 docx / Anki 需要的图片类型 */
export function imageExt(path: string, mime?: string): string {
  const p = (path.split('.').pop() || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(p)) return p === 'jpeg' ? 'jpg' : p
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

export function safeFileName(s: string): string {
  return String(s).replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 60) || '错题'
}
