'use client'

import type { MistakeFilters } from '@/types'

export interface ExportProgress { stage: string; done: number; total: number }
export interface ExportFile { name: string; mime: string; blob: Blob; warnings: string[] }

/** 服务端 NDJSON 进度流 → 浏览器下载文件 */
export async function streamExport(
  url: string,
  body: { ids?: string[]; filter?: MistakeFilters },
  onProgress?: (p: ExportProgress) => void
): Promise<ExportFile> {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({})) as any
    throw new Error(j.error || `导出失败（HTTP ${res.status}）`)
  }
  // 非流式（例如直接返回 JSON 错误）时的兜底
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('ndjson')) {
    const j = await res.json().catch(() => ({})) as any
    throw new Error(j.error || '导出失败：响应格式不正确')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  // 用对象包一层，避免 TS 把闭包里赋值的局部变量窄化成 never
  const state: { file: { name: string; mime: string; base64: string; warnings?: string[] } | null } = { file: null }

  const handle = (line: string) => {
    if (!line.trim()) return
    let msg: any
    try { msg = JSON.parse(line) } catch { return }
    if (msg.type === 'progress') onProgress?.({ stage: msg.stage, done: msg.done || 0, total: msg.total || 0 })
    else if (msg.type === 'error') throw new Error(msg.error || '导出失败')
    else if (msg.type === 'file') state.file = msg
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) handle(line)
  }
  if (buf.trim()) handle(buf)

  const file = state.file
  if (!file || !file.base64) throw new Error('导出失败：服务端未返回文件内容')

  const binary = atob(file.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: file.mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = file.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 15000)
  return { name: file.name, mime: file.mime, blob, warnings: file.warnings || [] }
}
