import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiKind } from '@/types'

type DB = SupabaseClient<any, any, any>

/** 命中缓存：相同 kind + input_hash + 已成功 → 直接返回，不再调用 Coding Plan（省钱） */
export async function findCached(db: DB, userId: string, kind: AiKind, inputHash: string) {
  const { data } = await db.from('ai_jobs')
    .select('id, result_json, created_at')
    .eq('user_id', userId).eq('kind', kind).eq('input_hash', inputHash).eq('status', 'succeeded')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data?.result_json ?? null
}

export async function createJob(db: DB, userId: string, kind: AiKind, inputHash: string, mistakeId?: string | null, model?: string) {
  const { data, error } = await db.from('ai_jobs')
    .insert({ user_id: userId, kind, input_hash: inputHash, mistake_id: mistakeId || null, status: 'running', attempts: 1, model })
    .select('id').single()
  if (error) throw new Error('记录 AI 任务失败：' + error.message)
  return data.id as string
}

export async function finishJob(db: DB, jobId: string, result: unknown, usage: { request_tokens: number; response_tokens: number }) {
  await db.from('ai_jobs').update({
    status: 'succeeded', result_json: result as any, ...usage, completed_at: new Date().toISOString()
  }).eq('id', jobId)
}

export async function failJob(db: DB, jobId: string, code: string, message: string) {
  await db.from('ai_jobs').update({
    status: 'failed', error_code: code, error: message.slice(0, 500), completed_at: new Date().toISOString()
  }).eq('id', jobId)
}

/** 每次「真实调用」才记一笔消耗（缓存命中不记，避免重复计费统计） */
export async function logUsage(db: DB, p: {
  userId: string; jobId: string; kind: AiKind; model: string
  usage: { request_tokens: number; response_tokens: number; total_tokens: number }
  status?: string; errorCode?: string
}) {
  await db.from('ai_usage_logs').insert({
    user_id: p.userId, job_id: p.jobId, kind: p.kind, model: p.model,
    request_tokens: p.usage.request_tokens, response_tokens: p.usage.response_tokens,
    total_tokens: p.usage.total_tokens, quota_units: 1,
    status: p.status || 'ok', error_code: p.errorCode || null
  })
}
