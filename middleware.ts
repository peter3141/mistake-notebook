import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/** 刷新 Supabase 会话 + 未登录跳转（魔法链接回调与分享页除外） */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const path = req.nextUrl.pathname
  const isPublic = path === '/login' || path.startsWith('/share/') || path.startsWith('/api/') ||
    path.startsWith('/_next') || path.startsWith('/sw.js') || path.startsWith('/manifest') || path === '/favicon.ico'

  // 没配 Supabase 时不拦截，让 /login 能正常打开并给出友好提示
  if (!url || !key) return res

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll(list: Array<{ name: string; value: string; options?: any }>) {
        list.forEach(({ name, value }) => req.cookies.set(name, value))
        res = NextResponse.next({ request: req })
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      }
    }
  })
  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !isPublic) {
    const to = req.nextUrl.clone(); to.pathname = '/login'; to.search = ''
    return NextResponse.redirect(to)
  }
  if (user && path === '/login') {
    const to = req.nextUrl.clone(); to.pathname = '/'; to.search = ''
    return NextResponse.redirect(to)
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
}
