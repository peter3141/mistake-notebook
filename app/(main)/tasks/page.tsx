'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ListTodo, Plus, Trash2, CalendarDays, BookOpen, Timer, Check, X, Loader2, Filter } from 'lucide-react'
import {
  listTasks, upsertTask, toggleTask, addSubtask, toggleSubtask, deleteSubtask, softDelete
} from '@/lib/data-v2'
import { listMistakes } from '@/lib/data'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  PRIORITY_LABEL, PRIORITY_COLOR, REPEAT_LABEL,
  type Task, type TaskInput, type Priority, type RepeatRule
} from '@/types'
import { fmtDateTime } from '@/lib/utils'

const EMPTY: TaskInput = {
  title: '', description: '', priority: 2, due_at: null,
  repeat_rule: 'none', tags: [], mistake_id: null
}
const localInput = (d: Date) => `${d.toLocaleDateString('sv-SE')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export default function TasksPage() {
  const toast = useToast()
  const [rows, setRows] = useState<Task[]>([])
  const [showDone, setShowDone] = useState(false)
  const [sort, setSort] = useState<'priority' | 'due' | 'newest'>('priority')
  const [filterPriority, setFilterPriority] = useState<'' | Priority>('')
  const [form, setForm] = useState<TaskInput | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [subText, setSubText] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState<{ id: string; title: string }[]>([])

  const load = () => void listTasks({ includeDone: showDone }).then(setRows).catch((e: any) => toast(e.message, 'err'))
  useEffect(load, [showDone])
  useEffect(() => {
    void listMistakes({ pageSize: 100 }).then((r) => setMistakes(r.rows.map((m) => ({ id: m.id, title: m.title })))).catch(() => {})
    if (new URLSearchParams(window.location.search).get('new') === '1') openNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openNew = () => { setEditId(null); setForm({ ...EMPTY }) }
  const openEdit = (t: Task) => {
    setEditId(t.id)
    setForm({
      title: t.title, description: t.description, priority: t.priority,
      due_at: t.due_at ? localInput(new Date(t.due_at)) : null,
      repeat_rule: t.repeat_rule, tags: t.tags || [], mistake_id: t.mistake_id
    })
  }

  const save = async () => {
    if (!form) return
    if (!form.title?.trim()) return toast('请填写任务标题', 'err')
    setSaving(true)
    try {
      await upsertTask({
        ...form, title: form.title.trim(),
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        tags: typeof form.tags === 'string' ? (form.tags as unknown as string).split(/[,，#]/).map((s) => s.trim()).filter(Boolean) : form.tags
      }, editId || undefined)
      toast(editId ? '任务已更新' : '任务已创建', 'ok')
      setForm(null); setEditId(null); load()
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setSaving(false) }
  }

  const visible = useMemo(() => {
    let r = rows.filter((t) => filterPriority ? t.priority === filterPriority : true)
    r = [...r].sort((a, b) => {
      if (sort === 'due') return (a.due_at || '9999').localeCompare(b.due_at || '9999')
      if (sort === 'newest') return b.created_at.localeCompare(a.created_at)
      return a.priority - b.priority
    })
    return r
  }, [rows, sort, filterPriority])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">待办任务</h1><p className="muted">优先级 · 截止时间 · 子任务 · 重复 · 与日程和番茄钟联动</p></div>
        <Link href="/calendar" className="btn-ghost"><CalendarDays size={16} /> 去日程</Link>
        <Link href="/focus" className="btn-ghost"><Timer size={16} /> 开个番茄钟</Link>
        <button className="btn-primary" onClick={openNew}><Plus size={16} /> 新建待办</button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Filter size={16} className="text-slate-400" />
        <select className="input max-w-[130px]" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as '' | Priority)}>
          <option value="">全部优先级</option><option value="1">高</option><option value="2">中</option><option value="3">低</option>
        </select>
        <select className="input max-w-[130px]" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="priority">优先级优先</option><option value="due">截止时间优先</option><option value="newest">最新创建</option>
        </select>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="accent-brand-600" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 显示已完成
        </label>
      </div>

      {visible.length === 0 ? <div className="card p-8 text-center muted">没有符合条件的任务 🎉</div> : (
        <div className="space-y-2">
          {visible.map((t) => {
            const subs = t.subtasks || []
            const done = subs.filter((s) => s.done).length
            return (
              <div key={t.id} className={`card p-3 ${t.completed ? 'opacity-65' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={t.completed}
                    onChange={(e) => void toggleTask(t.id, e.target.checked).then(load)} />
                  <span className={`flex-1 text-sm font-medium ${t.completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</span>
                  <span className={`badge ${PRIORITY_COLOR[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                  {t.repeat_rule !== 'none' && <span className="badge">{REPEAT_LABEL[t.repeat_rule]}</span>}
                  {t.due_at && <span className="text-xs text-slate-400">截止 {fmtDateTime(t.due_at)}</span>}
                  {t.focus_minutes > 0 && <span className="badge"><Timer size={11} /> 专注 {t.focus_minutes} 分</span>}
                  {t.mistake_id && <Link href={`/mistakes/${t.mistake_id}`} className="flex items-center gap-1 text-xs text-brand-600 hover:underline"><BookOpen size={12} /> 原题 →</Link>}
                  <button className="btn-ghost p-1.5 text-xs" onClick={() => openEdit(t)}>编辑</button>
                  <button className="btn-ghost p-1.5 text-rose-600" onClick={() => setConfirmId(t.id)}><Trash2 size={14} /></button>
                </div>
                {(t.description || t.tags?.length) && (
                  <div className="mt-1 pl-6 text-xs text-slate-500">
                    {t.description}{t.tags?.length ? ` · ${t.tags.map((x) => '#' + x).join(' ')}` : ''}
                  </div>
                )}
                {/* 子任务 */}
                <div className="mt-2 pl-6">
                  {subs.length > 0 && <div className="mb-1 text-[11px] text-slate-400">子任务 {done}/{subs.length}</div>}
                  {subs.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={s.done}
                        onChange={(e) => void toggleSubtask(s.id, e.target.checked).then(load)} />
                      <span className={s.done ? 'text-slate-400 line-through' : 'text-slate-600'}>{s.title}</span>
                      <button className="text-slate-300 hover:text-rose-600" onClick={() => void deleteSubtask(s.id).then(load)}><X size={12} /></button>
                    </div>
                  ))}
                  <div className="mt-1 flex gap-1">
                    <input className="input max-w-[240px] py-1 text-xs" placeholder="添加子任务后回车"
                      value={subText[t.id] || ''} onChange={(e) => setSubText({ ...subText, [t.id]: e.target.value })}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && (subText[t.id] || '').trim()) {
                          await addSubtask(t.id, subText[t.id].trim()); setSubText({ ...subText, [t.id]: '' }); load()
                        }
                      }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {form && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setForm(null)}>
          <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800">{editId ? '编辑待办' : '新建待办'}</h2>
            <div className="mt-4 space-y-3">
              <div><label className="label">标题 *</label><input className="input" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div><label className="label">说明</label><textarea className="input min-h-[70px]" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">优先级</label>
                  <select className="input" value={form.priority || 2} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) as Priority })}>
                    <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
                  </select></div>
                <div><label className="label">截止时间</label>
                  <input className="input" type="datetime-local" value={(form.due_at as string) || ''} onChange={(e) => setForm({ ...form, due_at: e.target.value || null })} /></div>
                <div><label className="label">重复</label>
                  <select className="input" value={form.repeat_rule || 'none'} onChange={(e) => setForm({ ...form, repeat_rule: e.target.value as RepeatRule })}>
                    {Object.entries(REPEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className="label">标签（逗号分隔）</label>
                  <input className="input" value={Array.isArray(form.tags) ? form.tags.join(',') : String(form.tags || '')} onChange={(e) => setForm({ ...form, tags: e.target.value as any })} /></div>
              </div>
              <div><label className="label">关联错题（可由错题复习计划自动生成）</label>
                <select className="input" value={form.mistake_id || ''} onChange={(e) => setForm({ ...form, mistake_id: e.target.value || null })}>
                  <option value="">不关联</option>
                  {mistakes.map((m) => <option key={m.id} value={m.id}>{m.title.slice(0, 40)}</option>)}
                </select></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setForm(null)}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 保存</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmId} title="删除这个待办？" busy={false}
        description="子任务会一并移入统一回收站，30 天内可恢复待办本身。"
        confirmText="移入回收站" onConfirm={async () => {
          if (confirmId) { await softDelete('task', confirmId); setConfirmId(null); load(); toast('已移入回收站', 'ok') }
        }} onClose={() => setConfirmId(null)} />
    </div>
  )
}
