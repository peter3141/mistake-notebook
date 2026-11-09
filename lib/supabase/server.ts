import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/** 服务端组件 / API 路由：读取当前登录用户的 cookie */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('缺少 Supabase 环境变量（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）')
  const cookieStore = cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list: Array<{ name: string; value: string; options?: any }>) {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { /* Server Component 中忽略 */ }
      }
    }
  })
}
