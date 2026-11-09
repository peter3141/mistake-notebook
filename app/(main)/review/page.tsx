'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, HelpCircle, X, Repeat2, Loader2, CalendarDays, ListTodo } from 'lucide-react'
import { reviewQueue, markReview, db } from '@/lib/data'
import { createReviewSchedule, createReviewTask } from '@/lib/data-v2'
import { useToast } from '@/components/Toast'
import { useOnline, offlineGuard } from '@/components/OnlineStatus'
import { renderMath, fmtDateTime } from '@/lib/utils'
import { MASTERY_LABEL, type Mastery, type Mistake, type ReviewResult } from '@/types'

export default function ReviewPage() {
  const [rows, setRows] = useState<Mistake[]>([])
  const [intervals, setIntervals] = useState<number[]>([1, 2, 4, 7, 15, 30])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [logs, setLogs] = useState<any[]>([])
  const [busy, setBusy] = useState('')
  const toast = useToast()
  const online = useOnline()

  const load = async () => {
    try {
      const [q, s, l] = await Promise.all([
        reviewQueue(50),
        fetch('/api/settings').then((r) => r.ok ? r.json() : null),
        db().from('review_logs').select('*, mistake:mistakes(title)').order('reviewed_at', { ascending: false }).limit(20)
      ])
      setRows(q)
      if (s?.review_intervals?.length) setIntervals(s.review_intervals)
      setLogs(l.data || [])
    } catch (e: any) { toast('加载失败：' + e.message, 'err') }
  }
  useEffect(() => { void load() }, [])

  const mark = async (m: Mistake, result: ReviewResult) => {
    if (!offlineGuard(online, toast)) return
    setBusy(m.id)
    try {
      const { days } = await markReview(m.id, result, notes[m.id] || '', intervals, m.review_interval_days)
      toast(`已记录，${days} 天后再复习`, 'ok')
      await load()
    } catch (e: any) { toast('记录失败：' + e.message, 'err') }
    finally { setBusy('') }
  }

  /** v2 联动 1：错题复习计划一键生成日程 / 待办（不依赖 AI） */
  const toSchedule = async (m: Mistake) => {
    try { await createReviewSchedule(m); toast('已生成复习日程，可到「日程」查看并跳转原题', 'ok') }
    catch (e: any) { toast('生成失败：' + e.message, 'err') }
  }
  const toTask = async (m: Mistake) => {
    try { await createReviewTask(m); toast('已生成复习待办，可到「待办」查看', 'ok') }
    catch (e: any) { toast('生成失败：' + e.message, 'err') }
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-xl font-bold text-slate-800">今日待复习</h1>
        <p className="muted">当前艾宾浩斯间隔：{intervals.join(' → ')} 天（可在设置页修改）。「不会」会回到第 1 档并累计错误次数。</p>
        <p className="muted mt-1">每题下方可以「一键生成复习日程 / 待办」，把下次复习时间同步到日程与任务清单。</p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-slate-500">暂时没有待复习的错题 🎉</p>
          <Link href="/review/random" className="btn-primary mt-4"><Repeat2 size={16} /> 去随机组卷练一练</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((m) => (
            <div key={m.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/mistakes/${m.id}`} className="flex-1 truncate font-medium text-slate-800 hover:text-brand-600">{m.title}</Link>
                <span className="badge">{m.subject?.name || '未分类'}</span>
                <span className={`badge ${m.mastery === 'mastered' ? 'bg-emerald-50 text-emerald-700' : m.mastery === 'fuzzy' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                  {MASTERY_LABEL[m.mastery as Mastery]}
                </span>
              </div>
              {m.content && <div className="prose-mistake mt-2 line-clamp-3 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: renderMath(m.content) }} />}
              {m.images?.[0]?.signedUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.images[0].signedUrl} alt="题目图片" loading="lazy" className="mt-2 max-h-40 rounded-lg" />
              )}
              <input className="input mt-3" placeholder="本次复习备注（可选）：错在哪、下次注意什么" value={notes[m.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [m.id]: e.target.value }))} />
              <div className="no-print mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost text-rose-600" disabled={busy === m.id} onClick={() => mark(m, 'again')}>{busy === m.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} 不会 / 又错</button>
                <button className="btn-ghost text-amber-600" disabled={busy === m.id} onClick={() => mark(m, 'fuzzy')}><HelpCircle size={15} /> 模糊</button>
                <button className="btn-primary" disabled={busy === m.id} onClick={() => mark(m, 'mastered')}><Check size={15} /> 已掌握</button>
                <button className="btn-ghost" onClick={() => toSchedule(m)}><CalendarDays size={15} /> 生成复习日程</button>
                <button className="btn-ghost" onClick={() => toTask(m)}><ListTodo size={15} /> 生成复习待办</button>
                <span className="muted self-center">上次复习 {m.review_count} 次 · 错误 {m.error_count} 次</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4">
        <h2 className="section-title">复习日志（最近 20 条）</h2>
        {logs.length === 0 ? <p className="muted mt-2">暂无记录</p> : (
          <ul className="mt-3 divide-y text-sm">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="text-slate-700">{l.mistake?.title || '（已删除的错题）'} · {l.result === 'again' ? '不会' : l.result === 'fuzzy' ? '模糊' : '已掌握'}{l.note ? ` · ${l.note}` : ''}</span>
                <span className="text-xs text-slate-400">{fmtDateTime(l.reviewed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
