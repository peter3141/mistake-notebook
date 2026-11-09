import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** 魔法链接 / 邮箱验证回调：把 code 换成 session 后回首页 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/'
  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, url.origin))
    return NextResponse.redirect(new URL('/login?error=callback', url.origin))
  }
  return NextResponse.redirect(new URL('/login', url.origin))
}
