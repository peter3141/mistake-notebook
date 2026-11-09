'use client'

import { useState } from 'react'
import { FileDown, Layers3, Loader2, AlertTriangle, X } from 'lucide-react'
import { streamExport, type ExportProgress } from '@/lib/export/client'
import { useToast } from '@/components/Toast'
import type { MistakeFilters } from '@/types'

/**
 * Word / Anki 导出入口。
 * ★ 不依赖 AI：服务端只读数据库和私有图片桶，AI 总开关关闭时完全可用，零 AI 调用、零费用。
 */
export function ExportButtons({
  ids, filter, scopeLabel = '错题', compact = false
}: {
  ids?: string[]
  filter?: MistakeFilters
  scopeLabel?: string
  compact?: boolean
}) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const run = async (kind: 'word' | 'anki') => {
    if (!ids?.length && !filter) { toast('请先勾选错题或设置筛选条件', 'err'); return }
    setBusy(kind); setWarnings([])
    setProgress({ stage: '正在连接服务器', done: 0, total: 1 })
    try {
      const r = await streamExport(
        kind === 'word' ? '/api/export/word' : '/api/export/anki',
        ids?.length ? { ids } : { filter },
        setProgress
      )
      setWarnings(r.warnings || [])
      toast(`已下载 ${r.name}${r.warnings?.length ? `（有 ${r.warnings.length} 条提示，请看下方）` : ''}`, 'ok')
    } catch (e: any) {
      toast(`导出失败：${e?.message || '请重试或缩小范围'}`, 'err')
    } finally { setBusy(''); setProgress(null) }
  }

  const active = busy === 'word' || busy === 'anki'
  const pct = progress?.total ? Math.min(100, Math.round(progress.done / progress.total * 100)) : 0

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost text-xs" disabled={active} onClick={() => void run('word')} title={`把${scopeLabel}导出成 .docx，图片真实内嵌`}>
          {busy === 'word' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          导出 Word
        </button>
        <button className="btn-ghost text-xs" disabled={active} onClick={() => void run('anki')} title="导出 Anki 可导入的 TSV/CSV + 图片包（zip）">
          {busy === 'anki' ? <Loader2 size={14} className="animate-spin" /> : <Layers3 size={14} />}
          导出 Anki
        </button>
        {!compact && <span className="muted text-xs">图片随文件走 · 不消耗 AI 额度 · 仅导出自己的数据</span>}
      </div>

      {active && progress && (
        <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50 p-2.5 text-xs text-brand-800">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> {progress.stage}</span>
            <span>{progress.done}/{progress.total}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <p className="mt-1.5 text-brand-700">题目多或图片多时可能需要十几秒，请不要关闭页面。</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          <div className="flex items-center justify-between font-medium">
            <span className="flex items-center gap-1"><AlertTriangle size={13} /> 导出完成，但有 {warnings.length} 条提示</span>
            <button onClick={() => setWarnings([])} className="text-amber-600"><X size={13} /></button>
          </div>
          <ul className="mt-1 list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <p className="mt-1">原图仍保存在网站云端，不会丢失；可缩小范围再导出一次补齐。</p>
        </div>
      )}
    </div>
  )
}
