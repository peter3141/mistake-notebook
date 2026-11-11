'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AiCapability, AiStatus } from '@/types'

interface AiCtx {
  status: AiStatus | null
  loading: boolean
  refresh: () => Promise<void>
  /** 总开关 + 子开关 + Key 配置三者全通过才返回 true */
  can: (cap: AiCapability) => boolean
  /** 不能用时给用户的中文原因 */
  reason: (cap: AiCapability) => string
}

const Ctx = createContext<AiCtx>({
  status: null, loading: true, refresh: async () => {}, can: () => false, reason: () => 'AI功能已关闭'
})

const CAP_LABEL: Record<AiCapability, string> = {
  organize: 'AI整理', ocr: 'OCR识题', similar: '相似题推荐', batch: 'AI批量整理',
  schedule: 'AI日程解析', note: 'AI笔记总结', plan: 'AI规划',
  textbook_quiz: '课本AI补充出题'
}

export function AiProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/ai/status', { cache: 'no-store' })
      setStatus(r.ok ? await r.json() : null)
    } catch { setStatus(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const can = (cap: AiCapability) => !!(status?.enabled && status.configured && status.caps[cap])

  const reason = (cap: AiCapability) => {
    if (!status) return 'AI功能已关闭'
    if (!status.configured) return 'AI未配置'
    if (!status.enabled) return 'AI功能已关闭'
    if (!status.caps[cap]) return `${CAP_LABEL[cap]}已关闭`
    return ''
  }

  return <Ctx.Provider value={{ status, loading, refresh, can, reason }}>{children}</Ctx.Provider>
}

export const useAi = () => useContext(Ctx)

/** 包装所有 AI 入口：不可用时自动隐藏（或显示置灰说明），关闭后绝不排队调用 */
export function AiOnly({ cap, children, fallback, showDisabledHint = false }: {
  cap: AiCapability
  children: React.ReactNode
  fallback?: React.ReactNode
  showDisabledHint?: boolean
}) {
  const { can, reason, loading } = useAi()
  if (loading) return null
  if (!can(cap)) {
    if (fallback !== undefined) return <>{fallback}</>
    return showDisabledHint
      ? <span className="badge bg-slate-100 text-slate-400" title={reason(cap)}>{reason(cap)}</span>
      : null
  }
  return <>{children}</>
}
