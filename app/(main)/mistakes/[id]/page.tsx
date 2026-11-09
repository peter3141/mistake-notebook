'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trash2, Sparkles, Loader2 } from 'lucide-react'
import { MistakeForm } from '@/components/MistakeForm'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { useAi, AiOnly } from '@/components/AiProvider'
import { ExportButtons } from '@/components/export/ExportButtons'
import { getMistake, softDeleteMistake } from '@/lib/data'
import type { Mistake } from '@/types'
import { fmtDateTime } from '@/lib/utils'

export default function MistakeDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const toast = useToast()
  const ai = useAi()
  const [m, setM] = useState<Mistake | null>(null)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [questions, setQuestions] = useState<string[]>([])
  const [similarBusy, setSimilarBusy] = useState(false)

  useEffect(() => { void getMistake(params.id).then(setM).catch((e) => setErr(e.message)) }, [params.id])

  const del = async () => {
    try { await softDeleteMistake(params.id); toast('已移入回收站，30 天内可恢复', 'ok'); router.push('/mistakes') }
    catch (e: any) { toast('删除失败：' + e.message, 'err') }
    finally { setConfirm(false) }
  }

  const similar = async () => {
    if (!m) return
    setSimilarBusy(true)
    try {
      const r = await fetch('/api/ai/similar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistakeId: m.id, title: m.title, content: m.content, knowledgePoints: m.knowledge_points })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '生成失败')
      setQuestions(j.questions || [])
    } catch (e: any) { toast('相似题生成失败：' + e.message, 'err') }
    finally { setSimilarBusy(false) }
  }

  if (err) return <div className="card p-6 text-sm text-rose-600">加载失败：{err}（可能是无权访问或题目已删除）</div>
  if (!m) return <div className="card p-6 text-sm text-slate-500">加载中…</div>

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href="/mistakes" className="btn-ghost"><ArrowLeft size={16} /> 返回</Link>
        <div className="flex-1">
          <h1 className="truncate text-xl font-bold text-slate-800">编辑错题</h1>
          <p className="muted">录入于 {fmtDateTime(m.created_at)} · 复习 {m.review_count} 次 · 错误 {m.error_count} 次</p>
        </div>
        <button className="btn-ghost text-rose-600" onClick={() => setConfirm(true)}><Trash2 size={16} /> 删除</button>
      </div>

      {/* 导出：Word 图片真实内嵌；Anki 输出 TSV/CSV + 媒体包。AI 关闭时照常可用 */}
      <div className="no-print card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="text-sm font-medium text-slate-700">导出这道错题</div>
        <ExportButtons ids={[m.id]} scopeLabel="这道错题" />
      </div>

      <MistakeForm initial={m} id={m.id} />

      {/* 相似题推荐：关闭 AI 时显示明确状态，不报错、不留白 */}
      <div className="no-print card mt-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="section-title flex items-center gap-2"><Sparkles size={16} className="text-brand-600" /> 相似题推荐</h3>
          <AiOnly cap="similar" fallback={<span className="badge bg-slate-100 text-slate-400">AI功能已关闭（{ai.reason('similar')}）</span>}>
            <button className="btn-ghost" onClick={similar} disabled={similarBusy}>
              {similarBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 生成 3 道练习题
            </button>
          </AiOnly>
        </div>
        <p className="mt-2 text-xs font-medium text-amber-700">⚠ 以下相似题均为「AI生成，需核对」，不得直接当作标准题使用，也不参与随机组卷抽题。</p>
        {questions.length > 0 && (
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        )}
        {m.similar_questions?.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <b>上次 AI 整理附带的相似题（AI生成，需核对）：</b>
            <ul className="mt-1 list-disc pl-4">{m.similar_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        )}
      </div>

      <ConfirmDialog open={confirm} title="删除这道错题？" description="删除后进入回收站，30 天内可以恢复；彻底删除需到回收站操作。"
        confirmText="移入回收站" onConfirm={del} onClose={() => setConfirm(false)} />
    </div>
  )
}
