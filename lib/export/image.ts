/**
 * 导出图片规范化。
 *
 * 为什么需要：站点上传时统一压缩成 WebP（体积最小），但 Word 的 docx 规范只可靠支持
 * png/jpeg/gif/bmp，Anki 对 WebP 的支持也取决于客户端 Qt 版本。因此导出时统一转成
 * PNG 或保留 JPEG，并同时算出真实像素尺寸，避免 Word 里图片过大或变形。
 *
 * sharp 是可选加速：装了就做真转换；没装（或平台不支持）则退回「只保留 png/jpeg，
 * 其余格式标记 unsupported 并跳过 + 给出提示」，绝不让导出整体失败或生成坏图。
 */

export interface NormalizedImage {
  buf: Buffer
  ext: 'png' | 'jpg'
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
  converted: boolean
  unsupported?: boolean
}

/** 不依赖任何库，从 PNG / JPEG 文件头读尺寸（降级路径用） */
function headerSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      const len = buf.readUInt16BE(i + 2)
      if (len < 2) break
      i += 2 + len
    }
  }
  return null
}

let sharpCache: any = undefined
async function loadSharp() {
  if (sharpCache !== undefined) return sharpCache
  try { sharpCache = (await import('sharp')).default } catch { sharpCache = null }
  return sharpCache
}

export async function normalizeImage(buf: Buffer, srcExt: string): Promise<NormalizedImage> {
  const sharp = await loadSharp()
  if (sharp) {
    try {
      const img = sharp(buf, { failOn: 'none' })
      const meta = await img.metadata()
      const width = meta.width || 800, height = meta.height || 600
      const isJpeg = srcExt === 'jpg' || srcExt === 'jpeg' || meta.format === 'jpeg'
      if (isJpeg) return { buf, ext: 'jpg', mime: 'image/jpeg', width, height, converted: false }
      if (srcExt === 'png' || meta.format === 'png') return { buf, ext: 'png', mime: 'image/png', width, height, converted: false }
      const png = await sharp(buf, { failOn: 'none' }).png({ compressionLevel: 8 }).toBuffer()
      return { buf: png, ext: 'png', mime: 'image/png', width, height, converted: true }
    } catch { /* 落到下面的降级路径 */ }
  }

  const size = headerSize(buf)
  if (srcExt === 'jpg' || srcExt === 'jpeg') {
    return { buf, ext: 'jpg', mime: 'image/jpeg', width: size?.width || 800, height: size?.height || 600, converted: false }
  }
  if (srcExt === 'png') {
    return { buf, ext: 'png', mime: 'image/png', width: size?.width || 800, height: size?.height || 600, converted: false }
  }
  // 没有 sharp 时无法把 WebP 转成 Word 能识别的格式：明确标记，由调用方跳过并提示
  return { buf, ext: 'png', mime: 'image/png', width: 800, height: 600, converted: false, unsupported: true }
}

/** 按最大宽度等比例缩放（docx 用像素，96 DPI） */
export function fitSize(width: number, height: number, maxWidth = 560, maxHeight = 720) {
  const r = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height), 1)
  return { width: Math.max(1, Math.round(width * r)), height: Math.max(1, Math.round(height * r)) }
}
