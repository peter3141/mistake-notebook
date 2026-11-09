import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SETTINGS_ROW } from '@/lib/ai/defaults'

export const dynamic = 'force-dynamic'

const Patch = z.object({
  ai_enabled: z.boolean().optional(),
  ai_organize: z.boolean().optional(),
  ai_ocr: z.boolean().optional(),
  ai_similar: z.boolean().optional(),
  ai_batch: z.boolean().optional(),
  ai_schedule_parse: z.boolean().optional(),
  ai_note_summary: z.boolean().optional(),
  ai_plan: z.boolean().optional(),
  reminder_enabled: z.boolean().optional(),
  default_calendar_view: z.enum(['day', 'week', 'month']).optional(),
  default_remind_minutes: z.number().int().min(0).max(1440).optional(),
  focus_minutes: z.number().int().min(1).max(180).optional(),
  break_minutes: z.number().int().min(1).max(60).optional(),
  ai_text_model: z.string().trim().max(80).optional(),
  ai_vision_model: z.string().trim().max(80).optional(),
  prompt_template: z.string().max(3000).optional(),
  review_intervals: z.array(z.number().int().min(1).max(365)).max(12).optional(),
  backup_reminder_days: z.number().int().min(1).max(365).optional(),
  default_print_template_id: z.string().uuid().nullable().optional(),
  reset: z.boolean().optional()
}).strict()

/** 读取当前用户设置（AI 开关跨设备同步的数据源） */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 老账号没有设置行时补一行（幂等）
  if (!data) {
    const { data: created } = await supabase.from('user_settings')
      .upsert({ user_id: user.id, ...DEFAULT_SETTINGS_ROW }).select('*').single()
    return NextResponse.json(created || { user_id: user.id, ...DEFAULT_SETTINGS_ROW })
  }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

/** 修改 AI 总/子开关。写库即刻生效，无需重新部署（验收 21） */
export async function PATCH(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  const parsed = Patch.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: '参数不合法', detail: parsed.error.flatten() }, { status: 400 })

  const { reset, ...patch } = parsed.data
  const values = reset ? { ...DEFAULT_SETTINGS_ROW } : patch
  const { data, error } = await supabase.from('user_settings')
    .upsert({ user_id: user.id, ...values, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
