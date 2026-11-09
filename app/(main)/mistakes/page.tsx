'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Printer, Download, Sparkles, Trash2, Share2, Copy, Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { FilterBar } from '@/components/FilterBar'
import { MistakeCard } from '@/components/MistakeCard'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { useAi, AiOnly } from '@/components/AiProvider'
import { ExportButtons } from '@/components/export/ExportButtons'
import { listMistakes, listSubjects, listBooks, listTags, softDeleteMistake, db } from '@/lib/data'
import { downloadBlob } from '@/lib/utils'
import type { AiOrganizeResult, Mistake, MistakeFilters } from '@/types'

export default function MistakesPage() {
  const toast = useToast()
  const ai = useAi()
  const [filters, setFilters] = useState<MistakeFilters>({ sort: 'newest', group: 'none', page: 1, pageSize: 20 })
  const [rows, setRows] = useState<Mistake[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [subjects, setSubjects] = useState<any[]>([])
  const [books, setBooks] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [batchResults, setBatchResults] = useState<{ id: string; title: string; result?: AiOrganizeResult; error?: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await listMistakes(filters)
      setRows(r.rows); setCount(r.count)
    } catch (e: any) { toast('加载失败：' + e.message, 'err') }
    finally { setLoading(false) }
  }, [filters])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void Promise.all([listSubjects(), listBooks(), listTags()]).then(([s, b, t]) => { setSubjects(s); setBooks(b); setTags(t) }) }, [])

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allIds = rows.map((r) => r.id)

  const groups = useMemo(() => groupRows(rows, filters.group || 'none', filters.dateBy || 'mistake_date'), [rows, filters.group, filters.dateBy])

  const printSelected = () => {
    if (!selected.size) return toast('请先勾选错题', 'err')
    window.location.href = `/print?ids=${[...selected].join(',')}`
  }
  const printFiltered = () => { window.location.href = `/print?filter=${encodeURIComponent(JSON.stringify(filters))}` }

  const exportSelected = async () => {
    if (!selected.size) return toast('请先勾选错题', 'err')
    const chosen = rows.filter((r) => selected.has(r.id))
    downloadBlob(`错题导出-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, mistakes: chosen }, null, 2))
    toast(`已导出 ${chosen.length} 道`, 'ok')
  }

  const deleteSelected = async () => {
    for (const id of selected) await softDeleteMistake(id)
    toast(`已把 ${selected.size} 道移入回收站`, 'ok')
    setSelected(new Set()); setConfirmDel(false); void load()
  }

  const createShare = async () => {
    const r = await fetch('/api/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'filter', filter_json: filters, expiresInDays: 7 })
    })
    const j = await r.json()
    if (!r.ok) return toast('生成失败：' + j.error, 'err')
    setShareUrl(j.url); toast('只读分享链接已生成（7 天有效）', 'ok')
  }
  const cancelShare = async () => {
    await fetch('/api/share', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
    setShareUrl(''); toast('已取消所有分享', 'ok')
  }

  // ★ 批量 AI：先显示预计调用次数 → 逐条调用（带进度）→ 结果预览 → 用户确认才写入
  const runBatch = async () => {
    if (!ai.can('batch')) return toast(ai.reason('batch'), 'err')
    const targets = rows.filter((r) => selected.has(r.id))
    if (!targets.length) return toast('请先勾选错题', 'err')
    if (!window.confirm(`批量 AI 整理预计调用 ${targets.length} 次（命中缓存会跳过、不计费）。确认继续？`)) return
    setBatchBusy(true); setBatchResults([]); setBatchProgress({ done: 0, total: targets.length })
    const out: typeof batchResults = []
    for (const m of targets) {
      try {
        const images = (m.images || []).slice(0, 1).map((i) => i.signedUrl).filter(Boolean) as string[]
        const r = await fetch('/api/ai/organize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: true, mistakeId: m.id, title: m.title, content: m.content, answer: m.answer, analysis: m.analysis, images })
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || '整理失败')
        out.push({ id: m.id, title: m.title, result: j.result })
      } catch (e: any) { out.push({ id: m.id, title: m.title, error: e.message }) }
      setBatchProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setBatchResults(out); setBatchBusy(false)
    toast('批量整理完成，请先预览结果', 'ok')
  }

  const applyBatch = async () => {
    const ok = batchResults.filter((b) => b.result)
    for (const b of ok) {
      const r = b.result!
      await db().from('mistakes').update({
        knowledge_points: r.knowledgePoints, cause: r.cause, difficulty: r.difficulty,
        answer: r.answerPoints.join('\n'), analysis: r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        ai_result: r as any, ai_applied_at: new Date().toISOString(), similar_questions: r.similarQuestions
      }).eq('id', b.id)
    }
    toast(`已应用 ${ok.length} 道（原内容已自动留历史版本，可回滚）`, 'ok')
    setBatchResults([]); setSelected(new Set()); void load()
  }

  const page = filters.page || 1, pages = Math.max(1, Math.ceil(count / (filters.pageSize || 20)))

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">错题列表</h1><p className="muted">共 {count} 道 · 已选 {selected.size} 道</p></div>
        <Link href="/trash" className="btn-ghost"><Trash2 size={15} /> 回收站</Link>
        <Link href="/mistakes/new" className="btn-primary"><Plus size={16} /> 新建错题</Link>
      </div>

      <FilterBar filters={filters} onChange={setFilters} subjects={subjects} books={books} tags={tags} />

      {/* 批量操作条 */}
      <div className="no-print card flex flex-wrap items-center gap-2 p-2.5">
        <button className="btn-ghost text-xs" onClick={() => setSelected(new Set(selected.size === allIds.length ? [] : allIds))}>
          {selected.size === allIds.length && allIds.length ? '取消全选' : '全选本页'}
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button className="btn-ghost text-xs" onClick={printSelected}><Printer size={14} /> 打印选中</button>
        <button className="btn-ghost text-xs" onClick={printFiltered}><Printer size={14} /> 按筛选结果打印</button>
        <button className="btn-ghost text-xs" onClick={exportSelected}><Download size={14} /> 导出选中</button>
        <AiOnly cap="batch">
          <button className="btn-ghost text-xs" onClick={runBatch} disabled={batchBusy}>
            {batchBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {batchBusy ? `整理中 ${batchProgress.done}/${batchProgress.total}` : 'AI批量整理'}
          </button>
        </AiOnly>
        {!ai.can('batch') && <span className="badge bg-slate-100 text-slate-400">AI功能已关闭</span>}
        <button className="btn-ghost text-xs text-rose-600" onClick={() => selected.size ? setConfirmDel(true) : toast('请先勾选', 'err')}><Trash2 size={14} /> 批量删除</button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button className="btn-ghost text-xs" onClick={createShare}><Share2 size={14} /> 生成只读分享</button>
        {shareUrl && <button className="btn-ghost text-xs" onClick={cancelShare}><X size={14} /> 取消分享</button>}
      </div>

      {/* 导出 Word / Anki：单题在详情页，这里支持「选中多题」与「按当前筛选结果」 */}
      <div className="no-print card flex flex-wrap gap-5 p-3">
        <div className="min-w-[230px] flex-1">
          <div className="mb-1.5 text-xs font-semibold text-slate-600">选中的 {selected.size} 道 → 导出</div>
          <ExportButtons ids={[...selected]} scopeLabel="选中错题" compact />
        </div>
        <div className="min-w-[230px] flex-1">
          <div className="mb-1.5 text-xs font-semibold text-slate-600">当前筛选结果（共 {count} 道，单次上限 300） → 导出</div>
          <ExportButtons filter={filters} scopeLabel="筛选结果" compact />
        </div>
      </div>

      {shareUrl && (
        <div className="no-print card flex flex-wrap items-center gap-2 border-emerald-200 bg-emerald-50 p-3 text-sm">
          <span className="flex-1 break-all text-emerald-800">{shareUrl}</span>
          <button className="btn-ghost text-xs" onClick={() => { void navigator.clipboard.writeText(shareUrl); toast('链接已复制', 'ok') }}><Copy size={14} /> 复制</button>
          <span className="text-xs text-emerald-700">7 天后自动过期，也可随时取消</span>
        </div>
      )}

      {/* 批量 AI 结果预览：确认后才写库 */}
      {batchResults.length > 0 && (
        <div className="no-print card border-brand-200 p-4">
          <div className="flex items-center justify-between">
            <h3 className="section-title">批量 AI 整理结果预览（尚未写入）</h3>
            <button onClick={() => setBatchResults([])} className="text-slate-400"><X size={17} /></button>
          </div>
          <ul className="mt-3 max-h-64 divide-y overflow-auto text-sm">
            {batchResults.map((b) => (
              <li key={b.id} className="py-2">
                <b>{b.title}</b>
                {b.error ? <span className="ml-2 text-rose-600">失败：{b.error}</span> :
                  <span className="ml-2 text-slate-500">知识点：{b.result?.knowledgePoints.join('、') || '—'} · 错因：{b.result?.cause} · 难度：{b.result?.difficulty}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={applyBatch}>确认应用全部成功项</button>
            <button className="btn-ghost" onClick={() => setBatchResults([])}>放弃</button>
            <span className="muted self-center">应用只补充字段，不删除原内容；每次修改都会留历史版本</span>
          </div>
        </div>
      )}

      {/* 列表 / 分组 */}
      {loading ? <div className="card p-10 text-center text-sm text-slate-400">加载中…</div> :
        rows.length === 0 ? <div className="card p-10 text-center text-sm text-slate-500">没有符合条件的错题，试着放宽筛选或 <Link href="/mistakes/new" className="text-brand-600 underline">新建一道</Link></div> :
        filters.group === 'calendar' ? (
          <CalendarView rows={rows} onPick={(d) => setFilters((f) => ({ ...f, dateFrom: d, dateTo: d, page: 1 }))} />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.label}>
                {g.label && <h2 className="mb-2 text-sm font-semibold text-slate-500">{g.label} <span className="font-normal text-slate-400">({g.rows.length})</span></h2>}
                <div className="space-y-2">{g.rows.map((m) => (
                  <MistakeCard key={m.id} m={m} selected={selected.has(m.id)} onSelect={toggle} onDelete={async (id) => { await softDeleteMistake(id); toast('已移入回收站', 'ok'); void load() }} />
                ))}</div>
              </div>
            ))}
          </div>
        )}

      {/* 分页 */}
      {pages > 1 && (
        <div className="no-print flex items-center justify-center gap-3 py-4 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}><ChevronLeft size={15} /> 上一页</button>
          <span className="text-slate-500">{page} / {pages}</span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}>下一页 <ChevronRight size={15} /></button>
        </div>
      )}

      <ConfirmDialog open={confirmDel} title={`把 ${selected.size} 道错题移入回收站？`}
        description="30 天内可在回收站恢复；彻底删除请到回收站操作。" confirmText="移入回收站"
        onConfirm={deleteSelected} onClose={() => setConfirmDel(false)} />
    </div>
  )
}

function groupRows(rows: Mistake[], group: string, dateBy: string) {
  if (group === 'none') return [{ label: '', rows }]
  const key = (m: Mistake) => {
    const d = dateBy === 'created_at' ? m.created_at : dateBy === 'next_review_at' ? m.next_review_at : m.mistake_date
    const date = new Date(d)
    if (group === 'month') return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`
    if (group === 'week') {
      const start = new Date(date); start.setDate(date.getDate() - ((date.getDay() + 6) % 7))
      return `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()} 起这一周`
    }
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
  }
  const map = new Map<string, Mistake[]>()
  rows.forEach((m) => { const k = key(m); map.set(k, [...(map.get(k) || []), m]) })
  return [...map.entries()].map(([label, r]) => ({ label, rows: r }))
}

function CalendarView({ rows, onPick }: { rows: Mistake[]; onPick: (d: string) => void }) {
  const byDay = new Map<string, number>()
  rows.forEach((m) => byDay.set(m.mistake_date, (byDay.get(m.mistake_date) || 0) + 1))
  const days = [...byDay.keys()].sort()
  return (
    <div className="card p-4">
      <h2 className="section-title mb-3">日历视图（点某天查看当天错题）</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
        {days.map((d) => (
          <button key={d} onClick={() => onPick(d)} className="rounded-lg border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50">
            <div className="text-xs text-slate-400">{d}</div>
            <div className="mt-1 text-lg font-bold text-brand-700">{byDay.get(d)} <span className="text-xs font-normal text-slate-500">题</span></div>
          </button>
        ))}
      </div>
      {!days.length && <p className="muted">当前页没有可显示在日历上的错题</p>}
    </div>
  )
}
