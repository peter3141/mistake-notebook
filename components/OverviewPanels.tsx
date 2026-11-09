'use client'

/** v2：统计页追加的「习惯 / 专注 / 目标 / 日程完成率」概览（不依赖 AI） */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, Timer, Target, CalendarCheck, ArrowRight } from 'lucide-react'
import { listHabits, listFocusSessions, listGoals, listSchedules } from '@/lib/data-v2'

export function OverviewPanels() {
  const [d, setD] = useState<{
    habits: any[]; focus: any[]; goals: any[]; schedules: any[]
  }>({ habits: [], focus: [], goals: [], schedules: [] })

  useEffect(() => {
    void Promise.all([
      listHabits(), listFocusSessions(500), listGoals(),
      listSchedules(new Date(Date.now() - 30 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString())
    ]).then(([habits, focus, goals, schedules]) => setD({ habits, focus, goals, schedules })).catch(() => {})
  }, [])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayMin = d.focus.filter((f: any) => new Date(f.started_at) >= today && f.mode === 'focus')
    .reduce((a, f: any) => a + (f.duration_minutes || 0), 0)
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - 7)
  const weekMin = d.focus.filter((f: any) => new Date(f.started_at) >= weekStart && f.mode === 'focus')
    .reduce((a, f: any) => a + (f.duration_minutes || 0), 0)
  const habitDone = d.habits.filter((h: any) => h.checkedToday).length
  const doneSch = d.schedules.filter((s: any) => s.status === 'done').length
  const avgProgress = d.goals.length ? Math.round(d.goals.reduce((a: number, g: any) => a + (g.progress || 0), 0) / d.goals.length) : 0

  const items = [
    { label: '今日习惯打卡', value: `${habitDone}/${d.habits.length}`, icon: Flame, href: '/habits', color: 'bg-orange-50 text-orange-600' },
    { label: '今日专注', value: `${todayMin} 分`, icon: Timer, href: '/focus', color: 'bg-violet-50 text-violet-600' },
    { label: '近 7 天专注', value: `${weekMin} 分`, icon: Timer, href: '/focus', color: 'bg-indigo-50 text-indigo-600' },
    { label: '目标平均进度', value: `${avgProgress}%`, icon: Target, href: '/goals', color: 'bg-emerald-50 text-emerald-600' },
    { label: '近 30 天完成日程', value: `${doneSch}/${d.schedules.length}`, icon: CalendarCheck, href: '/calendar', color: 'bg-sky-50 text-sky-600' }
  ]

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title">全模块概览（v2 新增）</h2>
        <span className="muted">习惯 · 专注 · 目标 · 日程完成率，关闭 AI 后照常统计</span>
        <Link href="/" className="ml-auto flex items-center gap-1 text-xs text-brand-600 hover:underline">今日聚合仪表盘 <ArrowRight size={13} /></Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((x) => (
          <Link key={x.label} href={x.href} className="flex items-center gap-2 rounded-lg border p-3 transition hover:border-brand-300">
            <span className={`rounded-lg p-2 ${x.color}`}><x.icon size={17} /></span>
            <div><div className="text-lg font-bold text-slate-800">{x.value}</div><div className="text-[11px] text-slate-500">{x.label}</div></div>
          </Link>
        ))}
      </div>
      {d.habits.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.habits.map((h: any) => (
            <span key={h.id} className={`chip ${h.checkedToday ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : ''}`}>
              <Flame size={12} /> {h.name} · 连续 {h.streak || 0} 天
            </span>
          ))}
        </div>
      )}
      {d.goals.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {d.goals.slice(0, 5).map((g: any) => (
            <div key={g.id} className="flex items-center gap-2 text-xs">
              <span className="w-32 truncate text-slate-600">{g.title}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${g.progress || 0}%` }} /></div>
              <span className="w-10 text-right text-slate-400">{g.progress || 0}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
