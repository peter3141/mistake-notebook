'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Flame, Plus, Check, Trash2, Loader2, ChevronLeft, ChevronRight,
  CalendarCheck, Bell, CalendarPlus, X, History, RotateCcw
} from 'lucide-react'
import { listHabits, upsertHabit, toggleHabitLog, softDelete, getHabitLog, upsertHabitLog, removeHabitLog } from '@/lib/data-v2'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { Habit } from '@/types'

const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => d.toLocaleDateString('sv-SE')
const offsetDate = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return key(d) }

interface Pending {
  title: string
  description: string
  confirmText: string
  danger?: boolean
  action: () => Promise<void>
}

export default function HabitsPage() {
  const toast = useToast()
  const [rows, setRows] = useState<Habit[]>([])
  const [cursor, setCursor] = useState(new Date())
  const [name, setName] = useState('')
  const [remind, setRemind] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [settings, setSettings] = useState<any>({})
  const [pending, setPending] = useState<Pending | null>(null)

  // 补打卡表单
  const [patchOpen, setPatchOpen] = useState(false)
  const [patchHabitId, setPatchHabitId] = useState('')
  const [patchDate, setPatchDate] = useState(offsetDate(1))
  const [patchNote, setPatchNote] = useState('')

  const load = () => void listHabits().then(setRows).catch((e: any) => toast(e.message, 'err'))
  // cursor 变化也会重新拉一次全量记录，保证切换月份后统计与补录结果一致
  useEffect(load, [cursor])
  useEffect(() => { void fetch('/api/settings', { cache: 'no-store' }).then((r) => r.ok ? r.json() : {}).then(setSettings).catch(() => {}) }, [])

  const create = async () => {
    if (!name.trim()) return toast('请填习惯名称', 'err')
    setAdding(true)
    try {
      await upsertHabit({ name: name.trim(), target_per_week: 7, remind_at: remind || null, color: '#6366f1' })
      setName(''); setRemind(''); toast('习惯已创建', 'ok'); load()
    } catch (e: any) { toast('创建失败：' + e.message, 'err') }
    finally { setAdding(false) }
  }

  const toggle = async (h: Habit, date: string) => {
    setBusy(h.id + date)
    try { await toggleHabitLog(h.id, date); load() }
    catch (e: any) { toast('打卡失败：' + e.message, 'err') }
    finally { setBusy('') }
  }

  /** 补录：先判断是否已有记录 → 一律弹二次确认（新增提示「确认补录」，重复提示「已打卡，是否修改」） */
  const submitPatch = async () => {
    const h = rows.find((x) => x.id === patchHabitId)
    if (!h) return toast('请先选择要补录的习惯', 'err')
    const today = key(new Date())
    if (!patchDate) return toast('请选择日期', 'err')
    if (patchDate > today) return toast('不能给未来日期补打卡', 'err')
    setBusy('checking')
    let existing = false
    try { existing = !!(await getHabitLog(h.id, patchDate)) }
    catch (e: any) { toast('检查打卡记录失败：' + e.message, 'err'); setBusy(''); return }
    setBusy('')
    setPending({
      title: existing ? `${patchDate} 已打卡，是否修改？` : `确认补录 ${patchDate} 的打卡？`,
      description: existing
        ? `「${h.name}」这一天已经有记录。点确认会更新这条记录的备注，不会新增重复记录（同一天同一习惯只保留一条）。想删掉这一天请到月视图点当天圆点旁的「取消」。`
        : `将给「${h.name}」补上 ${patchDate} 的打卡。补录会立即重算连续天数、月视图和统计。`,
      confirmText: existing ? '修改这条记录' : '确认补录',
      danger: false,
      action: async () => {
        await upsertHabitLog(h.id, patchDate, patchNote, existing)
        toast(existing ? '已更新该日记录，统计已刷新' : '补录成功，连续天数与统计已刷新', 'ok')
      }
    })
  }

  /** 取消某天打卡（二次确认） */
  const askCancel = (h: Habit, date: string) => setPending({
    title: `取消 ${date} 的打卡？`,
    description: `将删除「${h.name}」这一天的打卡记录，连续天数、月视图与统计会立即重算。打卡记录不进回收站，删除后如需恢复可再补录一次。`,
    confirmText: '取消该日打卡',
    danger: true,
    action: async () => { await removeHabitLog(h.id, date); toast('已取消该日打卡，统计已刷新', 'ok') }
  })

  const runPending = async () => {
    if (!pending) return
    setBusy('pending')
    try {
      await pending.action()
      setPending(null); setPatchOpen(false); setPatchNote('')
      load()  // ★ 全量重新拉取 → 连续天数 / 月视图 / KPI / 统计同步刷新
    } catch (e: any) { toast('操作失败：' + e.message, 'err') }
    finally { setBusy('') }
  }

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const wd = (first.getDay() + 6) % 7
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - wd)
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [cursor])

  const today = key(new Date())
  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`
  const monthKey = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`
  const doneToday = rows.filter((h) => h.checkedToday).length
  // 统计全部基于 allLogs 实时派生，随补录 / 取消立刻变化
  const logsFor = (h: Habit) => h.allLogs || h.monthLogs || []
  const monthCount = rows.reduce((a, h) => a + logsFor(h).filter((d) => d.startsWith(monthKey)).length, 0)
  const doneThisMonth = rows.reduce((a, h) => a + new Set(logsFor(h).filter((d) => d.startsWith(monthKey))).size, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">习惯打卡</h1><p className="muted">每日打卡 · 历史补录 · 连续天数 · 月视图 · 统计 · 提醒（纯本地功能，不依赖 AI）</p></div>
        <span className="badge"><Bell size={12} /> {settings.reminder_enabled ? '提醒已开启' : '提醒已关闭'}</span>
        <button className="btn-primary" onClick={() => { setPatchHabitId(rows[0]?.id || ''); setPatchDate(offsetDate(1)); setPatchOpen((v) => !v) }}>
          <CalendarPlus size={15} /> 补打卡
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="今日已打卡" value={`${doneToday} / ${rows.length}`} icon={CalendarCheck} />
        <Kpi label="最长连续天数" value={`${Math.max(0, ...rows.map((h) => h.streak || 0))} 天`} icon={Flame} />
        <Kpi label={`${cursor.getMonth() + 1} 月打卡次数`} value={`${monthCount} 次`} icon={Check} />
      </div>

      {/* 补打卡面板（补录和取消都要二次确认） */}
      {patchOpen && (
        <div className="card border-emerald-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title flex items-center gap-2"><History size={16} className="text-emerald-600" /> 补打卡（昨天 / 前天 / 任意过去日期）</h2>
            <button className="text-slate-400" onClick={() => setPatchOpen(false)}><X size={16} /></button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label">习惯</label>
              <select className="input" value={patchHabitId} onChange={(e) => setPatchHabitId(e.target.value)}>
                <option value="">请选择</option>{rows.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div><label className="label">补录日期（不能晚于今天）</label>
              <input className="input" type="date" max={today} value={patchDate} onChange={(e) => setPatchDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-2"><label className="label">备注（可选，例如「补记昨天的」）</label>
              <input className="input" value={patchNote} onChange={(e) => setPatchNote(e.target.value)} placeholder="可留空" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="muted text-xs">快捷选日期：</span>
            <button className="chip" onClick={() => setPatchDate(offsetDate(1))}>昨天</button>
            <button className="chip" onClick={() => setPatchDate(offsetDate(2))}>前天</button>
            <button className="chip" onClick={() => setPatchDate(offsetDate(7))}>7 天前</button>
            <button className="chip" onClick={() => setPatchDate(offsetDate(30))}>30 天前</button>
            <button className="btn-primary ml-auto" disabled={busy === 'checking'} onClick={() => void submitPatch()}>
              {busy === 'checking' ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} 下一步（二次确认）
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">同一天同一习惯只能有一条记录；若已打卡会提示「已打卡，是否修改」。补录 / 修改 / 取消都会重新拉取全部打卡记录并重算连续天数（最多回溯 730 天）、月视图和统计。</p>
        </div>
      )}

      {/* 新建 */}
      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[180px] flex-1"><label className="label">新习惯名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：背 20 个单词" onKeyDown={(e) => { if (e.key === 'Enter') void create() }} /></div>
        <div><label className="label">提醒时间</label><input className="input" type="time" value={remind} onChange={(e) => setRemind(e.target.value)} /></div>
        <button className="btn-primary" disabled={adding} onClick={create}>{adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 创建习惯</button>
      </div>

      {/* 今日打卡列表 */}
      <div className="card p-4">
        <h2 className="section-title">今日打卡</h2>
        <div className="mt-3 space-y-2">
          {rows.length === 0 && <p className="muted">还没有习惯，先在上面创建一个吧。</p>}
          {rows.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span className="h-3 w-3 rounded-full" style={{ background: h.color }} />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-700">{h.name}</div>
                <div className="text-xs text-slate-400">连续 {h.streak || 0} 天 · 本月 {logsFor(h).filter((d) => d.startsWith(monthKey)).length} 次 · 历史共 {logsFor(h).length} 次 {h.remind_at ? `· 提醒 ${h.remind_at.slice(0, 5)}` : ''}</div>
              </div>
              <button className={`btn ${h.checkedToday ? 'bg-emerald-600 text-white' : 'btn-ghost'}`} disabled={busy === h.id + today}
                onClick={() => toggle(h, today)}>
                {busy === h.id + today ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {h.checkedToday ? '今天已打卡' : '打卡'}
              </button>
              <button className="btn-ghost p-2 text-rose-600" onClick={() => setConfirmId(h.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* 月视图（基于全量 allLogs，支持点击过去日期补录、点圆点取消） */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
          <h2 className="section-title flex-1 text-center">{monthLabel}</h2>
          <span className="badge">本月有打卡 {doneThisMonth} 习惯·天</span>
          <button className="btn-ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const k = key(d)
            const inMonth = d.getMonth() === cursor.getMonth()
            const future = k > today
            const hits = rows.filter((h) => logsFor(h).includes(k))
            return (
              <div key={k} role="button" tabIndex={0}
                onClick={() => {
                  if (future) { toast('不能给未来日期补打卡', 'err'); return }
                  setPatchHabitId(rows[0]?.id || ''); setPatchDate(k); setPatchOpen(true)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !future) { setPatchHabitId(rows[0]?.id || ''); setPatchDate(k); setPatchOpen(true) } }}
                title={future ? '未来日期不能补录' : `点这里补录 / 修改 ${k} 的打卡`}
                className={`min-h-[60px] cursor-pointer rounded-lg border p-1 text-left transition hover:border-emerald-400 ${inMonth ? 'bg-white' : 'bg-slate-50 opacity-50'} ${k === today ? 'border-brand-400' : 'border-slate-100'} ${future ? 'opacity-30' : ''}`}>
                <div className="text-[10px] text-slate-400">{d.getDate()}</div>
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {hits.map((h) => (
                    <span key={h.id} title={`${h.name} · ${k}（点右侧 × 取消）`} className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[9px] text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.color }} />
                      <span
                        role="button" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); askCancel(h, k) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); askCancel(h, k) } }}
                        className="cursor-pointer font-bold text-rose-500 hover:text-rose-700">×</span>
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 text-center text-[9px] text-slate-400">{hits.length ? `${hits.length}/${rows.length}` : ''}</div>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-400">点任意过去日期可打开补打卡面板；点圆点旁的「×」可取消那天的打卡（都会二次确认）。补录后本视图、KPI 与连续天数立即重算。</p>
      </div>

      {/* 通用二次确认：补录 / 修改 / 取消 */}
      <ConfirmDialog open={!!pending} title={pending?.title || ''} description={pending?.description || ''}
        confirmText={pending?.confirmText} danger={pending?.danger !== false} busy={busy === 'pending'}
        onConfirm={runPending} onClose={() => setPending(null)} />

      <ConfirmDialog open={!!confirmId} title="删除这个习惯？" busy={false}
        description="打卡记录会一并移入统一回收站，30 天内可恢复习惯本身。"
        confirmText="移入回收站" onConfirm={async () => {
          if (confirmId) { await softDelete('habit', confirmId); setConfirmId(null); load(); toast('已移入回收站', 'ok') }
        }} onClose={() => setConfirmId(null)} />
    </div>
  )
}

function Kpi({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return <div className="card flex items-center gap-3 p-4"><div className="rounded-lg bg-orange-50 p-2 text-orange-600"><Icon size={18} /></div>
    <div><div className="text-xl font-bold text-slate-800">{value}</div><div className="text-xs text-slate-500">{label}</div></div></div>
}
