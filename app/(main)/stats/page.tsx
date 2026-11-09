'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Flame, TrendingUp, Target } from 'lucide-react'
import { db, listSubjects } from '@/lib/data'
import { OverviewPanels } from '@/components/OverviewPanels'
import { CAUSES, type Cause } from '@/types'

export default function StatsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [subjects, setSubjects] = useState<any[]>([])
  const [range, setRange] = useState('90')
  const [subjectId, setSubjectId] = useState('')
  const [bucket, setBucket] = useState<'week' | 'month'>('week')

  useEffect(() => {
    const load = async () => {
      const supabase = db()
      const [m, l, s] = await Promise.all([
        supabase.from('mistakes').select('id,title,subject_id,cause,difficulty,mastery,knowledge_points,mistake_date,created_at,next_review_at,review_count,error_count,deleted_at').is('deleted_at', null),
        supabase.from('review_logs').select('id,reviewed_at,result').order('reviewed_at', { ascending: false }).limit(1000),
        listSubjects()
      ])
      setRows(m.data || []); setLogs(l.data || []); setSubjects(s)
    }
    void load()
  }, [])

  const filtered = useMemo(() => rows.filter((r) => {
    if (subjectId && r.subject_id !== subjectId) return false
    if (range !== 'all') {
      const d = new Date(); d.setDate(d.getDate() - Number(range))
      if (new Date(r.created_at) < d) return false
    }
    return true
  }), [rows, subjectId, range])

  const causeCount = useMemo(() => {
    const m = Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<Cause, number>
    filtered.forEach((r) => { if (m[r.cause as Cause] !== undefined) m[r.cause as Cause]++ })
    return m
  }, [filtered])
  const maxCause = Math.max(1, ...Object.values(causeCount))

  // 知识点热力图：科目 × 知识点
  const heat = useMemo(() => {
    const m = new Map<string, number>()
    filtered.forEach((r) => (r.knowledge_points || []).forEach((k: string) => m.set(k, (m.get(k) || 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
  }, [filtered])
  const maxHeat = Math.max(1, ...heat.map((h) => h[1]))

  // 新增趋势（按周 / 按月）
  const trend = useMemo(() => {
    const m = new Map<string, number>()
    filtered.forEach((r) => {
      const d = new Date(r.created_at)
      let key: string
      if (bucket === 'month') key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      else { const s = new Date(d); s.setDate(d.getDate() - ((d.getDay() + 6) % 7)); key = `${s.getMonth() + 1}/${s.getDate()} 周` }
      m.set(key, (m.get(key) || 0) + 1)
    })
    return [...m.entries()].sort().slice(-12)
  }, [filtered, bucket])
  const maxTrend = Math.max(1, ...trend.map((t) => t[1]))

  const reviewed = logs.length
  const overdue = filtered.filter((r) => new Date(r.next_review_at) < new Date()).length
  const rate = reviewed + overdue > 0 ? Math.round(reviewed / (reviewed + overdue) * 100) : 100
  const weak = [...heat].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">统计与薄弱点分析</h1><p className="muted">找出反复出错的知识点和错因，优先复习它们；下方同时汇总全模块数据</p></div>

      <OverviewPanels />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs text-slate-500">时间范围</span>
        <select className="input h-9 w-32 py-1 text-xs" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="all">全部</option>
        </select>
        <span className="ml-2 text-xs text-slate-500">科目</span>
        <select className="input h-9 w-36 py-1 text-xs" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">全部科目</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="ml-auto text-sm text-slate-500">筛选后 <b className="text-brand-700">{filtered.length}</b> 道错题</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 错因分布 */}
        <div className="card p-4">
          <h2 className="section-title flex items-center gap-2"><BarChart3 size={16} /> 错因分类统计</h2>
          <div className="mt-3 space-y-2">
            {CAUSES.map((c) => {
              const n = causeCount[c], pct = Math.round(n / maxCause * 100)
              return (
                <div key={c}>
                  <div className="flex justify-between text-xs text-slate-600"><span>{c}</span><span>{n} 题 · {filtered.length ? Math.round(n / filtered.length * 100) : 0}%</span></div>
                  <div className="mt-1 h-2.5 rounded-full bg-slate-100">
                    <div className="h-2.5 rounded-full bg-rose-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 复习完成率 + 趋势 */}
        <div className="card p-4">
          <h2 className="section-title flex items-center gap-2"><Target size={16} /> 复习完成率</h2>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative h-24 w-24 shrink-0 rounded-full" style={{ background: `conic-gradient(#4f46e5 ${rate * 3.6}deg, #e2e8f0 0deg)` }}>
              <div className="absolute inset-3 flex items-center justify-center rounded-full bg-white text-lg font-bold text-slate-800">{rate}%</div>
            </div>
            <div className="text-sm text-slate-600"><p>已完成复习 <b>{reviewed}</b> 次</p><p className="mt-1">当前逾期待复习 <b className="text-rose-600">{overdue}</b> 题</p><p className="muted mt-1">完成率 = 已完成 ÷（已完成 + 逾期）</p></div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <h2 className="section-title flex items-center gap-2"><TrendingUp size={16} /> 新增趋势</h2>
            <select className="input h-8 w-24 py-0 text-xs" value={bucket} onChange={(e) => setBucket(e.target.value as any)}>
              <option value="week">按周</option><option value="month">按月</option>
            </select>
          </div>
          <div className="mt-3 flex h-28 items-end gap-1.5">
            {trend.length === 0 && <p className="muted">暂无数据</p>}
            {trend.map(([k, v]) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-1" title={`${k}: ${v} 题`}>
                <div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(4, v / maxTrend * 88)}px` }} />
                <span className="w-full truncate text-center text-[9px] text-slate-400">{k}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 知识点热力图 */}
      <div className="card p-4">
        <h2 className="section-title flex items-center gap-2"><Flame size={16} className="text-rose-500" /> 知识点热力图（颜色越深 = 错得越多）</h2>
        {heat.length === 0 ? <p className="muted mt-3">还没有填写知识点。录题时填上「知识点」，这里就会自动汇总薄弱点。</p> : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {heat.map(([k, n]) => {
                const t = n / maxHeat
                const bg = t > 0.75 ? 'bg-rose-600 text-white' : t > 0.5 ? 'bg-rose-400 text-white' : t > 0.25 ? 'bg-rose-200 text-rose-900' : 'bg-rose-50 text-rose-700'
                return <div key={k} className={`rounded-lg px-2.5 py-1.5 text-xs ${bg}`} title={`${k}: ${n} 题`}>{k} <b>{n}</b></div>
              })}
            </div>
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <b>最该先复习的 5 个薄弱点：</b>{weak.map(([k, n]) => `${k}(${n})`).join('、')}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
