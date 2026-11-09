import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { BUCKET, MAX_BATCH_FILES } from '@/lib/images/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLE_SEGMENT: Record<string, string> = {
  original: 'fullpage',   // 需求里的「整题」目录；用 ASCII 避免中文路径在签名 URL 里被二次编码
  cropped: 'cropped',
  inline: 'inline',
  thumbnail: 'thumbnail'
}
const ROLES = Object.keys(ROLE_SEGMENT)

/**
 * 图片上传统一入口（v4 图片架构）
 *
 * 顺序严格固定：校验 → 上传 Storage → 上传成功后才写数据库 → 返回签名 URL。
 * 任何一步失败都不写空记录；写库失败会回滚已上传的文件。
 * 用「带用户登录态」的 supabase client，Storage RLS + 数据库 RLS 同时生效，
 * 不使用 service_role，前端拿不到任何密钥。
 */
export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录后再上传图片' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: '请求格式不合法（需要 multipart/form-data）' }, { status: 400 })

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少图片文件' }, { status: 400 })

  const role = String(form.get('role') || 'inline')
  if (!ROLES.includes(role)) return NextResponse.json({ error: '图片用途不合法' }, { status: 400 })

  const mistakeId = String(form.get('mistakeId') || '') || null
  const draftId = String(form.get('draftId') || '') || null
  if (!mistakeId && !draftId) return NextResponse.json({ error: '缺少实体 id（mistakeId 或 draftId）' }, { status: 400 })
  const uuidLike = /^[0-9a-fA-F-]{36}$/
  if ((mistakeId && !uuidLike.test(mistakeId)) || (draftId && !uuidLike.test(draftId)))
    return NextResponse.json({ error: '实体 id 格式不合法' }, { status: 400 })

  // 归属校验：mistakeId 必须确实是自己的错题（RLS 之外再查一次，防止伪造 id）
  if (mistakeId) {
    const { data: own } = await supabase.from('mistakes').select('id').eq('id', mistakeId).eq('user_id', user.id).maybeSingle()
    if (!own) return NextResponse.json({ error: '错题不存在或无权访问' }, { status: 403 })
  }

  // 父图归属校验：裁剪图的 parentImageId 必须是自己的 original 图
  const parentImageId = String(form.get('parentImageId') || '') || null
  if (parentImageId) {
    if (!uuidLike.test(parentImageId)) return NextResponse.json({ error: '父图 id 格式不合法' }, { status: 400 })
    const { data: parent } = await supabase.from('mistake_images')
      .select('id').eq('id', parentImageId).eq('user_id', user.id).maybeSingle()
    if (!parent) return NextResponse.json({ error: '来源原图不存在或无权访问' }, { status: 403 })
  }

  let cropRect: { x: number; y: number; w: number; h: number } | null = null
  const rawRect = String(form.get('cropRect') || '')
  if (rawRect) {
    try {
      const r = JSON.parse(rawRect)
      if ([r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n)) && r.w > 0 && r.h > 0) {
        cropRect = { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: r.h }
      }
    } catch { /* 坐标可选，非法则忽略 */ }
  }

  // ---- 文件类型 / 大小 / 数量限制（每次只允许 1 张主图，批量由前端逐张调用并报进度） ----
  const files = form.getAll('file')
  if (files.length > MAX_BATCH_FILES) return NextResponse.json({ error: '单次上传图片数量超限' }, { status: 413 })
  const mimeOk = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  if (!mimeOk.includes(file.type)) return NextResponse.json({ error: `不支持的文件类型：${file.type}` }, { status: 415 })
  if (file.size === 0) return NextResponse.json({ error: '空文件' }, { status: 400 })
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: '单张图片超过 8MB，请压缩后再上传' }, { status: 413 })

  const entityId = (mistakeId || draftId)!
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : 'webp'
  const objectName = `${crypto.randomUUID()}.${ext}`
  const path = `${user.id}/mistakes/${ROLE_SEGMENT[role]}/${entityId}/${objectName}`

  // ① 上传压缩图到私有桶
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type, upsert: false, cacheControl: '3600'
  })
  if (upErr) return NextResponse.json({ error: `图片上传失败：${upErr.message}（未写入任何数据库记录，可重试）` }, { status: 502 })

  // 可选缩略图（前端 canvas 生成，不依赖 Storage 图片变换）
  let thumbnailPath: string | null = null
  const thumb = form.get('thumbnail')
  if (thumb instanceof File && thumb.size > 0 && thumb.size <= 1024 * 1024 && thumb.type.startsWith('image/')) {
    const tp = `${user.id}/mistakes/thumbnail/${entityId}/${crypto.randomUUID()}.webp`
    const { error: tErr } = await supabase.storage.from(BUCKET).upload(tp, thumb, { contentType: thumb.type, upsert: false })
    if (!tErr) thumbnailPath = tp
  }

  const num = (v: FormDataEntryValue | null) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }

  // ② 上传成功后才写数据库：只写路径与元数据，绝不写二进制 / Base64 / Blob
  const { data: row, error: dbErr } = await supabase.from('mistake_images').insert({
    user_id: user.id,
    mistake_id: mistakeId,
    draft_id: mistakeId ? null : draftId,
    storage_path: path,
    mime_type: file.type,
    width: num(form.get('width')),
    height: num(form.get('height')),
    size_bytes: file.size,
    original_size_bytes: num(form.get('originalSize')),
    compressed_size_bytes: file.size,
    image_role: role,
    parent_image_id: parentImageId,
    crop_rect: cropRect,
    thumbnail_path: thumbnailPath,
    sort_order: Number(form.get('sortOrder') || 0) || 0
  }).select('*').single()

  if (dbErr) {
    // 回滚：数据库没写成功，Storage 也不能留孤儿文件
    await supabase.storage.from(BUCKET).remove([path, ...(thumbnailPath ? [thumbnailPath] : [])])
    return NextResponse.json({ error: `图片已上传但登记失败：${dbErr.message}（已回滚文件，可重试）` }, { status: 502 })
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return NextResponse.json({
    id: row.id,
    storage_path: path,
    signedUrl: signed?.signedUrl || '',
    image_role: role,
    parent_image_id: parentImageId,
    crop_rect: cropRect,
    mime_type: file.type,
    width: row.width, height: row.height,
    size_bytes: file.size,
    original_size_bytes: row.original_size_bytes,
    mistake_id: mistakeId,
    draft_id: mistakeId ? null : draftId,
    thumbnail_path: thumbnailPath
  })
}
