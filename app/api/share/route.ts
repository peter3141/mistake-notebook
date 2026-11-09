import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const Create = z.object({
  scope: z.enum(['single', 'book', 'filter', 'note', 'schedule']),
  target_id: z.string().uuid().optional(),
  filter_json: z.record(z.any()).default({}),
  expiresInDays: z.number().int().min(1).max(365).default(7)
})

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const { data } = await supabase.from('share_links').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  return NextResponse.json(data || [])
}

/** 生成带过期时间的只读分享链接 */
export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const parsed = Create.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 })
  const b = parsed.data
  const expires = new Date(); expires.setDate(expires.getDate() + b.expiresInDays)
  const { data, error } = await supabase.from('share_links').insert({
    user_id: user.id, scope: b.scope, target_id: b.target_id || null,
    filter_json: b.filter_json, expires_at: expires.toISOString()
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
  return NextResponse.json({ ...data, url: `${origin.replace(/\/$/, '')}/share/${data.token}` })
}

/** 取消分享（单条或全部） */
export async function DELETE(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  let q = supabase.from('share_links').update({ revoked: true }).eq('user_id', user.id)
  if (b.id) q = q.eq('id', b.id)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
