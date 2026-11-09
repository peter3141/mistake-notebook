import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * 仅服务端使用、绕开 RLS 的管理客户端。
 * ⚠️ 只用 service_role key；绝不能加 NEXT_PUBLIC_ 前缀，绝不能 import 到任何 'use client' 文件。
 * 本项目只有「只读分享」API 用到它，且会做 token/过期/撤销校验 + 字段白名单。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('只读分享需要 SUPABASE_SERVICE_ROLE_KEY（仅服务端）')
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
