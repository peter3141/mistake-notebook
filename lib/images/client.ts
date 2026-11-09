'use client'

import type { ImageRole, UploadedImage } from '@/types'
import { compressForUpload, validateImageFile, type CompressResult } from './compress'

export interface UploadOptions {
  role: ImageRole
  mistakeId?: string
  draftId?: string
  parentImageId?: string
  cropRect?: { x: number; y: number; w: number; h: number }
  sortOrder?: number
  /** 已经压缩好的文件（裁剪场景）；不传则内部自动压缩 */
  compressed?: CompressResult
}

/** 单张：校验 → 压缩 → 上传 → 服务端写库 → 返回签名 URL。失败不产生任何数据库记录 */
export async function uploadImage(file: File, opts: UploadOptions): Promise<{ image: UploadedImage; preview: string; dataUrl: string }> {
  const bad = validateImageFile(file)
  if (bad) throw new Error(bad)
  const c = opts.compressed || await compressForUpload(file)
  const fd = new FormData()
  fd.append('file', c.file, c.file.name)
  if (c.thumbnail) fd.append('thumbnail', c.thumbnail, c.thumbnail.name)
  fd.append('role', opts.role)
  if (opts.mistakeId) fd.append('mistakeId', opts.mistakeId)
  if (opts.draftId) fd.append('draftId', opts.draftId)
  if (opts.parentImageId) fd.append('parentImageId', opts.parentImageId)
  if (opts.cropRect) fd.append('cropRect', JSON.stringify(opts.cropRect))
  fd.append('width', String(c.width))
  fd.append('height', String(c.height))
  fd.append('originalSize', String(c.originalSize))
  fd.append('sortOrder', String(opts.sortOrder || 0))

  const r = await fetch('/api/images/upload', { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({} as any))
  if (!r.ok) throw new Error(j.error || `上传失败（HTTP ${r.status}）`)
  return { image: j as UploadedImage, preview: c.previewUrl, dataUrl: c.dataUrl }
}

export interface BatchProgress { done: number; total: number; stage: string }

/** 批量上传：逐张串行，实时进度；单张失败不中断后续，但会返回失败清单 */
export async function uploadImagesBatch(
  files: File[], opts: Omit<UploadOptions, 'sortOrder'>,
  onProgress?: (p: BatchProgress) => void
): Promise<{ ok: Array<{ image: UploadedImage; preview: string; dataUrl: string }>; failed: Array<{ name: string; error: string }> }> {
  const ok: Array<{ image: UploadedImage; preview: string; dataUrl: string }> = []
  const failed: Array<{ name: string; error: string }> = []
  for (let i = 0; i < files.length; i++) {
    onProgress?.({ done: i, total: files.length, stage: `正在压缩并上传第 ${i + 1}/${files.length} 张` })
    try {
      ok.push(await uploadImage(files[i], { ...opts, sortOrder: i }))
    } catch (e: any) {
      failed.push({ name: files[i].name, error: e?.message || '上传失败' })
    }
    onProgress?.({ done: i + 1, total: files.length, stage: `第 ${i + 1}/${files.length} 张处理完成` })
  }
  return { ok, failed }
}

/** 重新签名（旧签名 1 小时过期后刷新用）；只能签自己的路径，服务端会再校验一次 */
export async function refreshSignedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const r = await fetch('/api/images/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [...new Set(paths)] })
  })
  if (!r.ok) return {}
  const j = await r.json()
  const map: Record<string, string> = {}
  ;(Array.isArray(j) ? j : []).forEach((d: any) => { if (d?.path && d?.signedUrl) map[d.path] = d.signedUrl })
  return map
}

/** 触发下载一个服务端返回的 NDJSON 文件消息（与 Word/Anki 导出共用协议） */
export function saveBase64File(name: string, mime: string, base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 15000)
}
