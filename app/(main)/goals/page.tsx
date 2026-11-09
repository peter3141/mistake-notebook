'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Target, Plus, Trash2, Check, Loader2, ListTodo, Flame, CalendarDays, X } from 'lucide-react'
import {
  listGoals, upsertGoal, addMilestone, toggleMilestone, deleteMilestone,
  recalcGoalProgress, softDelete
} from '@/lib/data-v2'
import { listTasks, listHabits } from '@/lib/data-v2'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { Goal, GoalInput } from '@/types'
import { fmtDate } from '@/lib/utils'

export default function GoalsPage() {
  const toast = useToast()
  const [rows, setRows] = useState<Goal[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [habits, setHabits] = useState<any[]>([])
  const [form, setForm] = useState<GoalInput | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [msText, setMsText] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = () => void Promise.all([listGoals(), listTasks({ limit: 200 }), listHabits()])
    .then(([g, t, h]) => { setRows(g); setTasks(t); setHabits(h) })
    .catch((e: any) => toast(e.message, 'err'))
  useEffect(load, [])

  const openNew = () => { setEditId(null); setForm({ title: '', description: '', target_date: null, status: 'active', habit_id: null }) }
  const openEdit = (g: Goal) => {
    setEditId(g.id)
    setForm({ title: g.title, description: g.description, target_date: g.target_date, status: g.status, habit_id: g.habit_id })
  }

  const save = async () => {
    if (!form) return
    if (!form.title?.trim()) return toast('请填写目标标题', 'err')
    setSaving(true)
    try {
      await upsertGoal({ ...form, title: form.title.trim() }, editId || undefined)
      toast(editId ? '目标已更新' : '目标已创建', 'ok')
      setForm(null); setEditId(null); load()
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">目标管理</h1><p className="muted">长期目标 · 里程碑 · 进度 · 关联待办与习惯（关闭 AI 也完全可用）</p></div>
        <Link href="/tasks" className="btn-ghost"><ListTodo size={15} /> 待办</Link>
        <Link href="/habits" className="btn-ghost"><Flame size={15} /> 习惯</Link>
        <button className="btn-primary" onClick={openNew}><Plus size={16} /> 新建目标</button>
      </div>

      {rows.length === 0 && !form && <div className="card p-8 text-center muted">还没有目标，点「新建目标」定一个吧 🎯</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((g) => {
          const ms = g.milestones || []
          const done = ms.filter((m) => m.done).length
          const linkedTasks = tasks.filter((t: any) => t.tags?.includes(g.title) || t.title.includes(g.title))
          const habit = habits.find((h: any) => h.id === g.habit_id)
          return (
            <div key={g.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Target size={17} className="text-brand-600" />
                <h2 className="flex-1 text-base font-semibold text-slate-800">{g.title}</h2>
                <span className="badge">{g.status === 'done' ? '已完成' : g.status === 'paused' ? '已暂停' : '进行中'}</span>
                <button className="btn-ghost p-1.5 text-xs" onClick={() => openEdit(g)}>编辑</button>
                <button className="btn-ghost p-1.5 text-rose-600" onClick={() => setConfirmId(g.id)}><Trash2 size={14} /></button>
              </div>
              {g.description && <p className="mt-1 text-xs text-slate-500">{g.description}</p>}
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                {g.target_date && <span className="flex items-center gap-1"><CalendarDays size={12} /> 目标日期 {fmtDate(g.target_date)}</span>}
                {habit && <span className="flex items-center gap-1"><Flame size={12} /> 关联习惯：{habit.name}（连续 {habit.streak || 0} 天）</span>}
                {linkedTasks.length > 0 && <span className="flex items-center gap-1"><ListTodo size={12} /> 关联待办 {linkedTasks.length} 项（标题含目标名或标签）</span>}
              </div>

              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500"><span>里程碑进度</span><span>{done}/{ms.length} · {g.progress}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${g.progress}%` }} /></div>
              </div>

              <ul className="mt-3 space-y-1">
                {ms.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={m.done}
                      onChange={async (e) => { await toggleMilestone(m.id, e.target.checked); await recalcGoalProgress(g.id); load() }} />
                    <span className={`flex-1 ${m.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{m.title}</span>
                    {m.due_date && <span className="text-xs text-slate-400">{fmtDate(m.due_date)}</span>}
                    <button className="text-slate-300 hover:text-rose-600" onClick={async () => { await deleteMilestone(m.id); await recalcGoalProgress(g.id); load() }}><X size={13} /></button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1">
                <input className="input py-1.5 text-xs" placeholder="添加里程碑后回车"
                  value={msText[g.id] || ''} onChange={(e) => setMsText({ ...msText, [g.id]: e.target.value })}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && (msText[g.id] || '').trim()) {
                      await addMilestone(g.id, msText[g.id].trim())
                      setMsText({ ...msText, [g.id]: '' }); await recalcGoalProgress(g.id); load()
                    }
                  }} />
              </div>
            </div>
          )
        })}
      </div>

      {form && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setForm(null)}>
          <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800">{editId ? '编辑目标' : '新建长期目标'}</h2>
            <div className="mt-4 space-y-3">
              <div><label className="label">目标标题 *</label><input className="input" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：本学期数学提到 90 分" /></div>
              <div><label className="label">描述</label><textarea className="input min-h-[70px]" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">目标日期</label><input className="input" type="date" value={form.target_date || ''} onChange={(e) => setForm({ ...form, target_date: e.target.value || null })} /></div>
                <div><label className="label">状态</label>
                  <select className="input" value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                    <option value="active">进行中</option><option value="paused">已暂停</option><option value="done">已完成</option>
                  </select></div>
              </div>
              <div><label className="label">关联习惯（显示连续打卡进度）</label>
                <select className="input" value={form.habit_id || ''} onChange={(e) => setForm({ ...form, habit_id: e.target.value || null })}>
                  <option value="">不关联</option>{habits.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select></div>
              <p className="text-xs text-slate-400">待办关联：在待办标题里写上目标名，或用同名标签，本页会自动汇总显示。</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setForm(null)}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 保存</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmId} title="删除这个目标？" busy={false}
        description="里程碑会一并移入统一回收站，30 天内可恢复目标本身。"
        confirmText="移入回收站" onConfirm={async () => {
          if (confirmId) { await softDelete('goal', confirmId); setConfirmId(null); load(); toast('已移入回收站', 'ok') }
        }} onClose={() => setConfirmId(null)} />
    </div>
  )
}
