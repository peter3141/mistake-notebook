import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Body = z.object({ paths: z.array(z.string().max(500)).max(50) })

/** 私有桶图片换签名 URL（前端直连 Storage 失败时的备用通道） */
export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 })
  const paths = parsed.data.paths.filter((p) => p.startsWith(`${user.id}/`))   // 只能签自己的图片
  const { data } = await supabase.storage.from('mistake-images').createSignedUrls(paths, 3600)
  return NextResponse.json(data || [])
}
