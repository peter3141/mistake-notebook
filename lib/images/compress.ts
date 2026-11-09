/**
 * 浏览器端图片压缩（v4 图片架构第 ① 步）
 *
 * 铁律：压缩只在浏览器内存里发生，压缩结果直接上传 Storage；
 *      dataUrl 只用于「当次预览 / 本地 OCR」，绝不写进数据库、绝不写进富文本 HTML。
 *
 * 目标：最长边 1600px、WebP、质量 0.8；若仍 > 500KB 则自动降到 0.7 / 1400px 再压一次。
 * 缩略图：前端 canvas 生成（最长边 320px），不依赖 Supabase 付费的图片变换服务。
 */
'use client'

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const TARGET_MAX_BYTES = 500 * 1024
export const ACCEPT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']

export interface CompressResult {
  file: File
  previewUrl: string
  dataUrl: string
  width: number
  height: number
  originalSize: number
  compressedSize: number
  thumbnail: File | null
  thumbnailDataUrl: string
}

function toFile(blob: Blob, name: string, type = 'image/webp') {
  return new File([blob], name, { type })
}

async function drawToCanvas(bitmap: ImageBitmap, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { canvas, w, h }
}

async function canvasToWebpFile(canvas: HTMLCanvasElement, name: string, quality: number): Promise<File> {
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality))
  if (!blob) throw new Error('图片压缩失败（canvas 编码失败）')
  return toFile(blob, name)
}

function readAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取图片失败'))
    r.readAsDataURL(file)
  })
}

/** 单张压缩。file 必须是图片，且 ≤ 8MB（调用前先 validateImageFile） */
export async function compressForUpload(file: File): Promise<CompressResult> {
  if (typeof window === 'undefined') throw new Error('压缩只能在浏览器端执行')
  const originalSize = file.size
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'

  // HEIC 等浏览器无法解码的格式：不尝试 canvas，直接拒绝并让用户换格式（不静默上传大图）
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { throw new Error('浏览器无法解码该图片（HEIC 请在手机上先转成 JPG/PNG），原图未被改动') }

  try {
    let pass = await drawToCanvas(bitmap, 1600)
    let out = await canvasToWebpFile(pass.canvas, `${baseName}.webp`, 0.8)
    if (out.size > TARGET_MAX_BYTES) {
      out = await canvasToWebpFile(pass.canvas, `${baseName}.webp`, 0.7)
    }
    if (out.size > TARGET_MAX_BYTES) {
      pass = await drawToCanvas(bitmap, 1400)
      out = await canvasToWebpFile(pass.canvas, `${baseName}.webp`, 0.72)
    }
    // 缩略图（前端生成，不占用 Storage 图片变换额度）
    let thumbnail: File | null = null
    let thumbnailDataUrl = ''
    try {
      const t = await drawToCanvas(bitmap, 320)
      thumbnail = await canvasToWebpFile(t.canvas, `${baseName}_thumb.webp`, 0.7)
      thumbnailDataUrl = await readAsDataUrl(thumbnail)
    } catch { /* 缩略图失败不阻塞主图上传 */ }

    return {
      file: out,
      previewUrl: URL.createObjectURL(out),
      dataUrl: await readAsDataUrl(out),
      width: pass.w, height: pass.h,
      originalSize,
      compressedSize: out.size,
      thumbnail,
      thumbnailDataUrl
    }
  } finally {
    bitmap.close()
  }
}

/** 上传前校验：类型 / 大小 / 数量。不通过直接抛错，绝不上传失败还写空记录 */
export function validateImageFile(file: File): string | null {
  if (!ACCEPT_MIME.includes(file.type)) return `不支持的文件类型 ${file.type || '未知'}，只接受图片`
  if (file.size === 0) return '空文件，请重新选择'
  if (file.size > MAX_UPLOAD_BYTES) return `单张图片超过 8MB（当前 ${(file.size / 1048576).toFixed(1)}MB），请先压缩或换一张`
  return null
}

/** 从原图 dataUrl 按用户框选区域裁剪（手动裁剪，不做 AI 自动切图） */
export async function cropFromDataUrl(
  dataUrl: string, rect: { x: number; y: number; w: number; h: number }
): Promise<File> {
  const img = new Image()
  img.src = dataUrl
  await img.decode().catch(() => new Promise<void>((res, rej) => {
    img.onload = () => res(); img.onerror = () => rej(new Error('原图加载失败'))
  }))
  const sx = Math.max(0, Math.round(rect.x))
  const sy = Math.max(0, Math.round(rect.y))
  const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(rect.w)))
  const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(rect.h)))
  const canvas = document.createElement('canvas')
  canvas.width = sw; canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas 裁剪')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvasToWebpFile(canvas, `crop_${Date.now()}.webp`, 0.82)
}
