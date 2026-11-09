/** 服务端图片常量（不含任何密钥，可被 API 路由安全 import） */
export const BUCKET = 'mistake-images'
export const MAX_BATCH_FILES = 1
export const SIGNED_URL_TTL = 3600
export const ROLE_SEGMENT: Record<string, string> = {
  original: 'fullpage',
  cropped: 'cropped',
  inline: 'inline',
  thumbnail: 'thumbnail'
}

/** HTML 里有多少张历史 Base64 图片（用于提示迁移，不用于展示） */
export function countLegacyBase64(html: string | null | undefined): number {
  if (!html) return 0
  return (html.match(/src\s*=\s*["']data:image\//gi) || []).length
}
