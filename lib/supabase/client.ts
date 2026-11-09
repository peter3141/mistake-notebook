import { createBrowserClient } from '@supabase/ssr'

/** 浏览器端 Supabase 客户端（受 RLS 约束，带登录态） */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('缺少 Supabase 环境变量：请在 .env.local 填写 NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY，然后重启 npm run dev')
  }
  return createBrowserClient(url, key)
}
