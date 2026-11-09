'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen, CalendarDays, ListTodo, Flame, Timer, CalendarClock, TrendingUp,
  Plus, Camera, Repeat2, Printer, PieChart, StickyNote, Target, CheckCircle2, ArrowRight
} from 'lucide-react'
import { overviewStats } from '@/lib/data-v2'
import { MASTERY_LABEL, PRIORITY_LABEL, type Mastery, type OverviewStats } from '@/types'
import { fmtDate } from '@/lib/utils'
import { useToast } from '@/components/Toast'

export default function DashboardPage() {
  const [o, setO] = useState<OverviewStats | null>(null)
  const toast = useToast()
  const load = () => void overviewStats().then(setO).catch((e) => toast('仪表盘加载失败：' + e.message, 'err'))
  useEffect(load, [])

  const cards = [
    { label: '今日日程', value: o?.todaySchedules.length ?? '—', icon: CalendarDays, color: 'bg-sky-50 text-sky-600', href: '/calendar' },
    { label: '今日待办', value: o?.todayTasks.length ?? '—', icon: ListTodo, color: 'bg-amber-50 text-amber-600', href: '/tasks' },
    { label: '今日待复习', value: o?.dueMistakes.length ?? '—', icon: CalendarClock, color: 'bg-rose-50 text-rose-600', href: '/review' },
    { label: '习惯打卡', value: o ? `${o.habitDone}/${o.habits.length}` : '—', icon: Flame, color: 'bg-orange-50 text-orange-600', href: '/habits' },
    { label: '今日专注', value: o ? `${o.todayFocusMinutes} 分` : '—', icon: Timer, color: 'bg-violet-50 text-violet-600', href: '/focus' },
    { label: '错题总数', value: o?.total ?? '—', icon: BookOpen, color: 'bg-brand-50 text-brand-600', href: '/mistakes' }
  ]

  const rows = o?.rows || []
  const subjectCount = new Map<string, number>()
  const masteryCount: Record<Mastery, number> = { unmastered: 0, fuzzy: 0, mastered: 0 }
  rows.forEach((r: any) => {
    masteryCount[r.mastery as Mastery] = (masteryCount[r.mastery as Mastery] || 0) + 1
    const sname = r.subject?.name || '未分类'
    subjectCount.set(sname, (subjectCount.get(sname) || 0) + 1)
  })
  const maxSubject = Math.max(1, ...subjectCount.values())

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">今天的一览 👋</h1>
        <p className="muted">数据已保存在云端，换手机、换网络登录同一账号都能看到同一批内容</p>
      </div>

      {/* 验收 9：五类今日数据 + 错题总数，一屏聚合 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card flex items-center gap-3 p-3.5 transition hover:border-brand-300">
            <div className={`rounded-lg p-2 ${c.color}`}><c.icon size={18} /></div>
            <div><div className="text-xl font-bold text-slate-800">{c.value}</div><div className="text-[11px] text-slate-500">{c.label}</div></div>
          </Link>
        ))}
      </div>

      <div className="no-print grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Quick href="/mistakes/new" icon={Plus} label="新建错题" />
        <Quick href="/mistakes/new?camera=1" icon={Camera} label="拍照录题" />
        <Quick href="/calendar?new=1" icon={CalendarDays} label="新建日程" />
        <Quick href="/notes?new=1" icon={StickyNote} label="新建笔记" />
        <Quick href="/review/random" icon={Repeat2} label="随机组卷" />
        <Quick href="/print" icon={Printer} label="打印 / PDF" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 今日日程 */}
        <div className="card p-4">
          <div className="flex items-center justify-between"><h2 className="section-title">今日日程</h2><Link href="/calendar" className="text-xs text-brand-600 hover:underline">全部 →</Link></div>
          {!o?.todaySchedules.length ? <p className="muted mt-3">今天没有安排 🎉</p> : (
            <ul className="mt-3 space-y-2">
              {o!.todaySchedules.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 w-11 shrink-0 text-xs tabular-nums text-slate-400">
                    {s.all_day ? '全天' : new Date(s.start_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`flex-1 truncate ${s.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {s.title}{s.mistake_id && <Link href={`/mistakes/${s.mistake_id}`} className="ml-1 text-[11px] text-brand-600">关联错题 →</Link>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 今日待办 */}
        <div className="card p-4">
          <div className="flex items-center justify-between"><h2 className="section-title">今日待办</h2><Link href="/tasks" className="text-xs text-brand-600 hover:underline">全部 →</Link></div>
          {!o?.todayTasks.length ? <p className="muted mt-3">待办都完成了 🎉</p> : (
            <ul className="mt-3 space-y-2">
              {o!.todayTasks.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className={`badge shrink-0 ${t.priority === 1 ? 'bg-rose-50 text-rose-600' : ''}`}>{PRIORITY_LABEL[t.priority]}</span>
                  <span className="flex-1 truncate text-slate-700">{t.title}</span>
                  {t.mistake_id && <Link href={`/mistakes/${t.mistake_id}`} className="text-[11px] text-brand-600">原题 →</Link>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 今日待复习 */}
        <div className="card p-4">
          <div className="flex items-center justify-between"><h2 className="section-title">今日待复习错题</h2><Link href="/review" className="text-xs text-brand-600 hover:underline">去复习 →</Link></div>
          {!o?.dueMistakes.length ? <p className="muted mt-3">今天没有待复习的错题 🎉</p> : (
            <ul className="mt-3 space-y-2">
              {o!.dueMistakes.slice(0, 5).map((m: any) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/mistakes/${m.id}`} className="truncate text-slate-700 hover:text-brand-600">{m.title}</Link>
                  <span className="shrink-0 text-[11px] text-slate-400">{m.subject?.name || '未分类'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 习惯 / 专注 / 目标 */}
        <div className="card p-4">
          <h2 className="section-title">习惯打卡与专注</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(o?.habits || []).map((h) => (
              <Link key={h.id} href="/habits" className={`chip ${h.checkedToday ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : ''}`}>
                {h.checkedToday ? <CheckCircle2 size={13} /> : <Flame size={13} />}
                {h.name} · 连续 {h.streak || 0} 天
              </Link>
            ))}
            {!o?.habits.length && <span className="muted">还没有习惯，<Link href="/habits" className="text-brand-600">去创建 →</Link></span>}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="今日专注" value={`${o?.todayFocusMinutes ?? 0} 分`} />
            <Stat label="本周专注" value={`${o?.weekFocusMinutes ?? 0} 分`} />
            <Stat label="本周新增错题" value={String(o?.weekNew ?? 0)} />
          </div>
          <Link href="/goals" className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <span className="flex items-center gap-2"><Target size={15} /> 查看长期目标与里程碑</span><ArrowRight size={15} />
          </Link>
        </div>

        {/* 错题分布（v1 保留） */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">掌握状态分布</h2>
            <Link href="/stats" className="flex items-center gap-1 text-xs text-brand-600 hover:underline"><PieChart size={13} /> 错因与热力图</Link>
          </div>
          <div className="mt-3 space-y-2.5">
            {(Object.keys(MASTERY_LABEL) as Mastery[]).map((k) => {
              const n = masteryCount[k] || 0, pct = rows.length ? Math.round(n / rows.length * 100) : 0
              return (
                <div key={k}>
                  <div className="flex justify-between text-xs text-slate-500"><span>{MASTERY_LABEL[k]}</span><span>{n} 题 · {pct}%</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${k === 'mastered' ? 'bg-emerald-500' : k === 'fuzzy' ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
          <h2 className="section-title mt-5">科目分布</h2>
          <div className="mt-3 space-y-1.5 text-xs text-slate-600">
            {[...subjectCount.entries()].length === 0 && <p className="muted">还没有错题</p>}
            {[...subjectCount.entries()].map(([name, n]) => (
              <div key={name} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate">{name}</span>
                <div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${n / maxSubject * 100}%` }} /></div>
                <span className="w-8 text-right">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <TrendingUp size={17} className="text-slate-400" />
        <span className="flex-1 text-slate-600">本月新增 {o?.monthNew ?? 0} 道错题。建议每月导出一次 JSON 全量备份（含日程、待办、笔记、习惯、专注记录）。</span>
        <Link href="/settings" className="btn-ghost">去设置里导出</Link>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 py-2"><div className="text-base font-bold text-slate-800">{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>
}

function Quick({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  return (
    <Link href={href} className="card flex flex-col items-center justify-center gap-1.5 py-3.5 text-slate-600 transition hover:border-brand-300 hover:text-brand-700">
      <Icon size={18} /><span className="text-xs font-medium">{label}</span>
    </Link>
  )
}
