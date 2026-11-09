'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Printer, Trash2, Pencil,
  MapPin, Clock, Sparkles, Check, X, BookOpen, Loader2
} from 'lucide-react'
import {
  listSchedules, upsertSchedule, setScheduleStatus, softDelete,
  confirmParsedSchedule
} from '@/lib/data-v2'
import { listMistakes } from '@/lib/data'
import { AiOnly, useAi } from '@/components/AiProvider'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  PRIORITY_LABEL, PRIORITY_COLOR, REPEAT_LABEL, SCHEDULE_CATEGORIES,
  type Schedule, type ScheduleInput, type ScheduleParseResult, type RepeatRule, type Priority
} from '@/types'

type View = 'day' | 'week' | 'month'
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => d.toLocaleDateString('sv-SE')
/** Date → <input type="datetime-local"> 需要的本地字符串 */
const localInput = (d: Date) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fromLocalInput = (s: string) => new Date(s).toISOString()

const EMPTY: ScheduleInput = {
  title: '', description: '', start_at: '', end_at: null, all_day: false,
  location: '', category: '学习', priority: 2, status: 'todo',
  repeat_rule: 'none', remind_minutes: 15, mistake_id: null
}

export default function CalendarPage() {
  const toast = useToast()
  const ai = useAi()
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(new Date())
  const [rows, setRows] = useState<Schedule[]>([])
  const [mistakes, setMistakes] = useState<{ id: string; title: string }[]>([])
  const [form, setForm] = useState<ScheduleInput | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiPreview, setAiPreview] = useState<ScheduleParseResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [settings, setSettings] = useState<any>({})

  const load = async () => {
    const { from, to } = rangeOf(cursor, view)
    try { setRows(await listSchedules(from, to)) }
    catch (e: any) { toast('日程加载失败：' + e.message, 'err') }
  }
  useEffect(() => { void load() }, [cursor, view])
  useEffect(() => {
    void listMistakes({ pageSize: 100 }).then((r) => setMistakes(r.rows.map((m) => ({ id: m.id, title: m.title })))).catch(() => {})
    void fetch('/api/settings', { cache: 'no-store' }).then((r) => r.ok ? r.json() : {}).then(setSettings).catch(() => {})
    if (new URLSearchParams(window.location.search).get('new') === '1') openNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openNew = (at?: Date) => {
    const d = at || new Date()
    if (!at) { d.setHours(9, 0, 0, 0) }
    setEditId(null)
    setForm({
      ...EMPTY,
      start_at: localInput(d),
      end_at: localInput(new Date(d.getTime() + 60 * 60000)),
      remind_minutes: settings.default_remind_minutes ?? 15
    })
  }
  const openEdit = (s: Schedule) => {
    setEditId(s.id)
    setForm({
      title: s.title, description: s.description,
      start_at: localInput(new Date(s.start_at)),
      end_at: s.end_at ? localInput(new Date(s.end_at)) : null,
      all_day: s.all_day, location: s.location, category: s.category,
      priority: s.priority, status: s.status, repeat_rule: s.repeat_rule,
      remind_minutes: s.remind_minutes, mistake_id: s.mistake_id
    })
  }

  const save = async () => {
    if (!form) return
    if (!form.title?.trim()) return toast('请填写日程标题', 'err')
    if (!form.start_at) return toast('请选择开始时间', 'err')
    setSaving(true)
    try {
      await upsertSchedule({
        ...form,
        title: form.title.trim(),
        start_at: fromLocalInput(form.start_at),
        end_at: form.end_at ? fromLocalInput(form.end_at) : null
      }, editId || undefined)
      toast(editId ? '日程已更新' : '日程已创建', 'ok')
      setForm(null); setEditId(null); await load()
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setSaving(false) }
  }

  const parseNatural = async () => {
    if (!aiText.trim()) return toast('先用一句话描述日程，例如「下周三下午3点复习数学，提前30分钟提醒」', 'err')
    setAiBusy(true)
    try {
      const r = await fetch('/api/ai/schedule-parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText, now: new Date().toISOString(), timezoneOffsetMinutes: -new Date().getTimezoneOffset() })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'AI 解析失败')
      setAiPreview(j.result as ScheduleParseResult)
      toast('已生成预览，请核对后再确认创建', 'ok')
    } catch (e: any) { toast(e.message, 'err') }
    finally { setAiBusy(false) }
  }

  const confirmParsed = async () => {
    if (!aiPreview) return
    setAiBusy(true)
    try {
      await confirmParsedSchedule(aiPreview)
      toast('日程已创建（AI 结果经你确认）', 'ok')
      setAiPreview(null); setAiText(''); await load()
    } catch (e: any) { toast('创建失败：' + e.message, 'err') }
    finally { setAiBusy(false) }
  }

  const move = (delta: number) => {
    const d = new Date(cursor)
    if (view === 'day') d.setDate(d.getDate() + delta)
    else if (view === 'week') d.setDate(d.getDate() + 7 * delta)
    else d.setMonth(d.getMonth() + delta)
    setCursor(d)
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Schedule[]>()
    rows.forEach((s) => {
      const k = dayKey(new Date(s.start_at))
      const arr = map.get(k) || []; arr.push(s); map.set(k, arr)
    })
    return map
  }, [rows])

  const days = useMemo(() => daysOf(cursor, view), [cursor, view])
  const title = view === 'month'
    ? `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`
    : view === 'week'
      ? `${dayKey(days[0])} ~ ${dayKey(days[days.length - 1])}`
      : `${dayKey(cursor)}`

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">日程管理</h1><p className="muted">日 / 周 / 月视图 · 提醒 · 重复 · 关联错题 · 打印导出 PDF</p></div>
        <Link href="/tasks" className="btn-ghost">待办联动 →</Link>
        <button className="btn-ghost" onClick={() => window.print()}><Printer size={16} /> 打印本{view === 'day' ? '日' : view === 'week' ? '周' : '月'}</button>
        <button className="btn-primary" onClick={() => openNew()}><Plus size={16} /> 新建日程</button>
      </div>

      {/* 视图切换 */}
      <div className="no-print card flex flex-wrap items-center gap-2 p-3">
        <button className="btn-ghost" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
        <button className="btn-ghost" onClick={() => setCursor(new Date())}>今天</button>
        <button className="btn-ghost" onClick={() => move(1)}><ChevronRight size={16} /></button>
        <span className="mx-2 font-semibold text-slate-700">{title}</span>
        <div className="ml-auto flex rounded-lg bg-slate-100 p-1 text-sm">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} onClick={() => { setView(v); setCursor(new Date()) }}
              className={`rounded-md px-3 py-1.5 ${view === v ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>
              {v === 'day' ? '日' : v === 'week' ? '周' : '月'}
            </button>
          ))}
        </div>
      </div>

      {/* AI 自然语言创建日程：受总开关 + ai_schedule_parse 子开关控制 */}
      <div className="no-print card p-3">
        <AiOnly cap="schedule" showDisabledHint fallback={
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Sparkles size={14} className="mr-1 inline" /> AI自然语言创建日程：{ai.reason('schedule')}。手动新建日程完全正常，不影响使用。
          </div>
        }>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles size={16} className="text-brand-600" />
            <input className="input max-w-xl flex-1" placeholder="用一句话描述，例如：明天上午9点在图书馆复习物理，提前30分钟提醒"
              value={aiText} onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void parseNatural() }} />
            <button className="btn-primary" disabled={aiBusy} onClick={parseNatural}>
              {aiBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 生成预览
            </button>
          </div>
          {aiPreview && (
            <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3">
              <div className="text-sm font-semibold text-brand-800">预览（确认后才会创建，不会自动写入）</div>
              <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
                <div>标题：<b>{aiPreview.title}</b></div>
                <div>开始：<b>{new Date(aiPreview.start_at).toLocaleString('zh-CN')}</b></div>
                <div>结束：<b>{aiPreview.end_at ? new Date(aiPreview.end_at).toLocaleString('zh-CN') : '—'}</b></div>
                <div>地点：<b>{aiPreview.location || '—'}</b> · 分类：<b>{aiPreview.category}</b></div>
                <div>优先级：<b>{PRIORITY_LABEL[aiPreview.priority]}</b> · 重复：<b>{REPEAT_LABEL[aiPreview.repeat_rule]}</b></div>
                <div>备注：<b>{aiPreview.notes || '—'}</b></div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary" disabled={aiBusy} onClick={confirmParsed}><Check size={15} /> 确认应用并创建</button>
                <button className="btn-ghost" onClick={() => setAiPreview(null)}><X size={15} /> 放弃</button>
              </div>
            </div>
          )}
        </AiOnly>
      </div>

      {/* 日历网格 */}
      <div className={`no-print grid gap-2 ${view === 'month' ? 'grid-cols-7' : view === 'week' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-1'}`}>
        {days.map((d) => {
          const k = dayKey(d)
          const list = byDay.get(k) || []
          const isToday = k === dayKey(new Date())
          return (
            <div key={k} className={`card min-h-[92px] p-2 ${isToday ? 'border-brand-400 ring-1 ring-brand-100' : ''}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs font-semibold ${isToday ? 'text-brand-700' : 'text-slate-500'}`}>
                  {view === 'month' ? d.getDate() : `${d.getMonth() + 1}/${d.getDate()}`} 日
                </span>
                <button className="text-slate-300 hover:text-brand-600" title="在这天新建日程" onClick={() => openNew(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0))}><Plus size={14} /></button>
              </div>
              <div className="space-y-1">
                {list.map((s) => (
                  <button key={s.id} onClick={() => openEdit(s)}
                    className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] ${s.status === 'done' ? 'bg-slate-50 text-slate-400 line-through' : PRIORITY_COLOR[s.priority]}`}>
                    {s.all_day ? '全天 · ' : new Date(s.start_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' '}{s.title}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* 日程清单 + 提醒/关联跳转 */}
      <div className="no-print card p-4">
        <h2 className="section-title">本{view === 'day' ? '日' : view === 'week' ? '周' : '月'}日程清单（{rows.length}）</h2>
        {rows.length === 0 ? <p className="muted mt-2">这个时间范围还没有日程。</p> : (
          <ul className="mt-3 divide-y">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={s.status === 'done'}
                  onChange={(e) => void setScheduleStatus(s.id, e.target.checked ? 'done' : 'todo').then(load)} />
                <span className={`flex-1 ${s.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{s.title}</span>
                <span className="flex items-center gap-1 text-xs text-slate-400"><Clock size={12} />{new Date(s.start_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                {s.location && <span className="flex items-center gap-1 text-xs text-slate-400"><MapPin size={12} />{s.location}</span>}
                {s.mistake_id && <Link href={`/mistakes/${s.mistake_id}`} className="flex items-center gap-1 text-xs text-brand-600 hover:underline"><BookOpen size={12} /> 查看关联错题 →</Link>}
                <span className={`badge ${PRIORITY_COLOR[s.priority]}`}>{PRIORITY_LABEL[s.priority]}</span>
                <button className="btn-ghost p-1.5" onClick={() => openEdit(s)} title="编辑"><Pencil size={14} /></button>
                <button className="btn-ghost p-1.5 text-rose-600" onClick={() => setConfirmId(s.id)} title="删除"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 打印区：屏幕隐藏，打印时显示；按日/周/月分组，A4 不跨页 */}
      <div className="print-only-block print-sheet">
        <div className="print-header">
          <h1 className="text-lg font-bold">日程表 · {title}</h1>
          <p className="text-xs">个人综合管理网站 · 打印日期 {dayKey(new Date())}</p>
        </div>
        {days.map((d) => {
          const list = byDay.get(dayKey(d)) || []
          if (!list.length && view === 'month') return null
          return (
            <div key={dayKey(d)} className="print-block">
              <h2 className="text-sm font-semibold">{dayKey(d)}</h2>
              {list.length === 0 ? <p className="text-xs text-slate-400">无日程</p> : (
                <ul className="calendar-print-list mt-1 space-y-1 text-xs">
                  {list.map((s) => (
                    <li key={s.id}>
                      【{s.all_day ? '全天' : new Date(s.start_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}】
                      {s.title} {s.location ? `｜地点：${s.location}` : ''} {s.mistake_id ? '｜已关联错题' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* 新建 / 编辑弹窗 */}
      {form && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setForm(null)}>
          <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800">{editId ? '编辑日程' : '新建日程'}</h2>
            <div className="mt-4 space-y-3">
              <div><label className="label">标题 *</label><input className="input" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：复习二次函数错题" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">开始时间 *</label><input className="input" type="datetime-local" value={form.start_at || ''} onChange={(e) => setForm({ ...form, start_at: e.target.value })} /></div>
                <div><label className="label">结束时间</label><input className="input" type="datetime-local" value={form.end_at || ''} onChange={(e) => setForm({ ...form, end_at: e.target.value || null })} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">地点</label><input className="input" value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="图书馆 / 教室" /></div>
                <div><label className="label">分类</label>
                  <select className="input" value={form.category || '学习'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {SCHEDULE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select></div>
                <div><label className="label">优先级</label>
                  <select className="input" value={form.priority || 2} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) as Priority })}>
                    <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
                  </select></div>
                <div><label className="label">重复</label>
                  <select className="input" value={form.repeat_rule || 'none'} onChange={(e) => setForm({ ...form, repeat_rule: e.target.value as RepeatRule })}>
                    {Object.entries(REPEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className="label">提前提醒（分钟）</label><input className="input" type="number" min={0} value={form.remind_minutes ?? 15} onChange={(e) => setForm({ ...form, remind_minutes: Number(e.target.value) })} /></div>
                <div><label className="label">关联错题（点击日程可跳转）</label>
                  <select className="input" value={form.mistake_id || ''} onChange={(e) => setForm({ ...form, mistake_id: e.target.value || null })}>
                    <option value="">不关联</option>
                    {mistakes.map((m) => <option key={m.id} value={m.id}>{m.title.slice(0, 40)}</option>)}
                  </select></div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" className="accent-brand-600" checked={!!form.all_day} onChange={(e) => setForm({ ...form, all_day: e.target.checked })} /> 全天日程
              </label>
              <div><label className="label">备注</label><textarea className="input min-h-[70px]" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setForm(null)}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 保存</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmId} title="删除这个日程？" busy={false}
        description="删除后进入统一回收站，30 天内可恢复。"
        confirmText="移入回收站" onConfirm={async () => {
          if (confirmId) { await softDelete('schedule', confirmId); setConfirmId(null); await load(); toast('已移入回收站', 'ok') }
        }} onClose={() => setConfirmId(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
function rangeOf(cursor: Date, view: View) {
  const days = daysOf(cursor, view)
  return {
    from: new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate()).toISOString(),
    to: new Date(days[days.length - 1].getFullYear(), days[days.length - 1].getMonth(), days[days.length - 1].getDate() + 1).toISOString()
  }
}

function daysOf(cursor: Date, view: View): Date[] {
  if (view === 'day') return [new Date(cursor)]
  if (view === 'week') {
    const start = new Date(cursor)
    const wd = (start.getDay() + 6) % 7   // 周一为一周第一天
    start.setDate(start.getDate() - wd)
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const wd = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - wd)
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}
