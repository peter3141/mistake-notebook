import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readSettings } from '@/lib/ai/guard'
import { publicAiSummary } from '@/lib/ai/config'
import type { AiStatus } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * 只读取开关与配置状态；★ 本身永远不会调用 Coding Plan。
 * 前端 AiProvider 用它决定隐藏/置灰所有 AI 入口；设置页用它显示状态与模型名。
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const cfg = publicAiSummary()
  if (!user) {
    const empty: AiStatus = {
      enabled: false, caps: {
        organize: false, ocr: false, similar: false, batch: false,
        schedule: false, note: false, plan: false
      },
      configured: cfg.configured, configIssues: cfg.configIssues,
      textModel: cfg.textModel, visionModel: cfg.visionModel, ocrModel: cfg.ocrModel,
      baseUrl: cfg.baseUrl, statusText: cfg.configured ? '已关闭' : 'AI未配置', usage: { calls: 0, units: 0 }
    }
    return NextResponse.json(empty, { status: 401 })
  }
  const s = await readSettings(supabase, user.id)
  const effective = s.ai_enabled && cfg.configured
  const { data: usageRows } = await supabase.from('ai_usage_logs')
    .select('quota_units').eq('user_id', user.id).eq('status', 'ok')
  const units = (usageRows || []).reduce((a, r) => a + (r.quota_units || 0), 0)

  const body: AiStatus = {
    enabled: s.ai_enabled,
    caps: {
      organize: effective && s.ai_organize,
      ocr: effective && s.ai_ocr,
      similar: effective && s.ai_similar,
      batch: effective && s.ai_batch,
      schedule: effective && s.ai_schedule_parse,
      note: effective && s.ai_note_summary,
      plan: effective && s.ai_plan
    },
    configured: cfg.configured,
    configIssues: cfg.configIssues,
    textModel: cfg.textModel,
    visionModel: cfg.visionModel,
    ocrModel: cfg.ocrModel,
    baseUrl: cfg.baseUrl,
    statusText: !cfg.configured ? 'AI未配置' : s.ai_enabled ? '已开启' : '已关闭',
    usage: { calls: usageRows?.length || 0, units }
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
