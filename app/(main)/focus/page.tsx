'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Timer, Play, Pause, RotateCcw, ListTodo, BookOpen, Coffee, BarChart3, CheckCircle2 } from 'lucide-react'
import { listFocusSessions, listFocusTargets, saveFocusSession } from '@/lib/data-v2'
import { useToast } from '@/components/Toast'
import type { FocusSession } from '@/types'
import { fmtDateTime } from '@/lib/utils'

export default function FocusPage() {
  const toast = useToast()
  const [settings, setSettings] = useState({ focus_minutes: 25, break_minutes: 5 })
  const [targets, setTargets] = useState<{ tasks: any[]; mistakes: any[] }>({ tasks: [], mistakes: [] })
  const [taskId, setTaskId] = useState('')
  const [mistakeId, setMistakeId] = useState('')
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [mode, setMode] = useState<'focus' | 'break'>('focus')
  const [seconds, setSeconds] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState('')
  const startedAt = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = () => void Promise.all([listFocusSessions(200), listFocusTargets()])
    .then(([s, t]) => { setSessions(s); setTargets(t) }).catch((e: any) => toast(e.message, 'err'))
  useEffect(() => {
    load()
    void fetch('/api/settings', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((s) => {
      if (s) { setSettings({ focus_minutes: s.focus_minutes || 25, break_minutes: s.break_minutes || 5 }); setSeconds((s.focus_minutes || 25) * 60) }
    }).catch(() => {})
  }, [])

  const totalMinutes = mode === 'focus' ? settings.focus_minutes : settings.break_minutes

  useEffect(() => {
    if (!running) { if (timer.current) clearInterval(timer.current); return }
    timer.current = setInterval(() => setSeconds((s) => {
      if (s <= 1) {
        clearInterval(timer.current!)
        setRunning(false)
        void finish()
        return 0
      }
      return s - 1
    }), 1000)
    return () => { if (timer.current) clearInterval(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const start = () => {
    if (!startedAt.current) startedAt.current = new Date().toISOString()
    setRunning(true)
  }
  const pause = () => setRunning(false)
  const reset = () => { setRunning(false); startedAt.current = null; setSeconds(totalMinutes * 60) }

  const finish = async () => {
    const end = new Date()
    if (mode === 'break') {
      toast('休息结束，开始下一个专注吧 ☕', 'ok')
      setMode('focus'); setSeconds(settings.focus_minutes * 60); startedAt.current = null
      return
    }
    try {
      await saveFocusSession({
        task_id: taskId || null, mistake_id: mistakeId || null,
        started_at: startedAt.current || new Date(end.getTime() - settings.focus_minutes * 60000).toISOString(),
        ended_at: end.toISOString(), duration_minutes: settings.focus_minutes, note
      })
      toast(`专注完成！已记录 ${settings.focus_minutes} 分钟，建议休息 ${settings.break_minutes} 分钟`, 'ok')
      setMode('break'); setSeconds(settings.break_minutes * 60); startedAt.current = null
      setNote(''); load()
    } catch (e: any) { toast('保存专注记录失败：' + e.message, 'err') }
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayMin = sessions.filter((s) => new Date(s.started_at) >= todayStart && s.mode === 'focus')
    .reduce((a, s) => a + s.duration_minutes, 0)
  const weekStart = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 7)
  const weekMin = sessions.filter((s) => new Date(s.started_at) >= weekStart && s.mode === 'focus')
    .reduce((a, s) => a + s.duration_minutes, 0)

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const pct = Math.max(0, Math.min(100, (1 - seconds / (totalMinutes * 60)) * 100))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">番茄钟</h1><p className="muted">专注计时 · 关联待办/错题 · 专注记录与统计 · 休息提醒（不依赖 AI）</p></div>
        <Link href="/tasks" className="btn-ghost"><ListTodo size={15} /> 待办</Link>
        <Link href="/stats" className="btn-ghost"><BarChart3 size={15} /> 统计</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card flex flex-col items-center p-8">
          <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${mode === 'focus' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'}`}>
            {mode === 'focus' ? <Timer size={13} /> : <Coffee size={13} />}
            {mode === 'focus' ? `专注 ${settings.focus_minutes} 分钟` : `休息 ${settings.break_minutes} 分钟`}
          </div>
          <div className="relative mt-6 flex h-52 w-52 items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="90" fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle cx="100" cy="100" r="90" fill="none" stroke={mode === 'focus' ? '#4f46e5' : '#f59e0b'} strokeWidth="10"
                strokeLinecap="round" strokeDasharray={2 * Math.PI * 90} strokeDashoffset={2 * Math.PI * 90 * (1 - pct / 100)} />
            </svg>
            <div className="text-center"><div className="text-5xl font-bold tabular-nums text-slate-800">{mm}:{ss}</div>
              <div className="mt-1 text-xs text-slate-400">{running ? '进行中…' : '准备开始'}</div></div>
          </div>

          <div className="mt-6 flex gap-2">
            {!running ? <button className="btn-primary" onClick={start}><Play size={16} /> 开始</button>
              : <button className="btn-ghost" onClick={pause}><Pause size={16} /> 暂停</button>}
            <button className="btn-ghost" onClick={reset}><RotateCcw size={16} /> 重置</button>
            {mode === 'break' && <button className="btn-ghost" onClick={() => { setMode('focus'); setSeconds(settings.focus_minutes * 60) }}><Timer size={16} /> 跳过休息</button>}
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">专注时长与休息时长可在「设置 → 日程提醒与专注设置」修改，云端同步。</p>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="section-title">关联对象（可选）</h2>
            <div className="mt-3 space-y-2">
              <div><label className="label">关联待办</label>
                <select className="input" value={taskId} onChange={(e) => { setTaskId(e.target.value); if (e.target.value) setMistakeId('') }}>
                  <option value="">不关联</option>{targets.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select></div>
              <div><label className="label">关联错题</label>
                <select className="input" value={mistakeId} onChange={(e) => { setMistakeId(e.target.value); if (e.target.value) setTaskId('') }}>
                  <option value="">不关联</option>{targets.mistakes.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select></div>
              <div><label className="label">本次备注</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：第二章错题重做" /></div>
            </div>
            <p className="mt-2 text-xs text-slate-400">完成后会写入专注记录，并把时长累计到关联待办。</p>
          </div>

          <div className="card p-4">
            <h2 className="section-title">专注统计</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Mini label="今日" value={`${todayMin} 分`} /><Mini label="近 7 天" value={`${weekMin} 分`} /><Mini label="累计次数" value={String(sessions.length)} />
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="section-title">专注记录</h2>
        {sessions.length === 0 ? <p className="muted mt-2">还没有专注记录，点上面的「开始」试试。</p> : (
          <ul className="mt-3 divide-y text-sm">
            {sessions.slice(0, 30).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <CheckCircle2 size={15} className="text-emerald-500" />
                <span className="text-slate-600">{fmtDateTime(s.started_at)}</span>
                <span className="font-medium text-slate-800">{s.duration_minutes} 分钟</span>
                {s.task && <Link href="/tasks" className="flex items-center gap-1 text-xs text-brand-600"><ListTodo size={12} /> {s.task.title}</Link>}
                {s.mistake && <Link href={`/mistakes/${s.mistake.id}`} className="flex items-center gap-1 text-xs text-brand-600"><BookOpen size={12} /> {s.mistake.title}</Link>}
                {s.note && <span className="text-xs text-slate-400">{s.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 py-2"><div className="text-base font-bold text-slate-800">{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>
}
