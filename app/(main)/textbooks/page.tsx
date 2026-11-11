'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Library, Plus, Pencil, Trash2, Layers, BookOpen, ImagePlus, Loader2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { listSubjects, signPaths } from '@/lib/data'
import {
  listTextbooks, upsertTextbook, textbookDeleteImpact,
  softDeleteTextbookWithRelations, uploadTextbookCover
} from '@/lib/textbooks'
import type { Textbook, Subject } from '@/types'

const EMPTY = {
  name: '', subject_id: '', publisher: '', edition: '', grade: '', volume: '', note: '', cover_path: ''
}

export default function TextbooksPage() {
  const toast = useToast()
  const [rows, setRows] = useState<Textbook[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState({ subject_id: '', grade: '', edition: '' })
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<{ id: string; name: string; impact: string } | null>(null)

  const load = async () => {
    const [list, subs] = await Promise.all([listTextbooks(filter), listSubjects()])
    setRows(list); setSubjects(subs as Subject[])
    const paths = list.map((r) => r.cover_path).filter(Boolean) as string[]
    if (paths.length) {
      const m = await signPaths(paths)
      setCovers(Object.fromEntries([...m].map(([k, v]) => [k, v])))
    } else setCovers({})
  }
  useEffect(() => { void load().catch((e) => toast('课本加载失败：' + e.message, 'err')) }, [filter.subject_id, filter.grade, filter.edition])

  const grades = useMemo(() => [...new Set(rows.map((r) => r.grade).filter(Boolean))], [rows])
  const editions = useMemo(() => [...new Set(rows.map((r) => r.edition).filter(Boolean))], [rows])
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => { setEditing(null); setForm({ ...EMPTY }); setCoverFile(null); setDialog(true) }
  const openEdit = (r: Textbook) => {
    setEditing(r.id)
    setForm({
      name: r.name, subject_id: r.subject_id || '', publisher: r.publisher || '',
      edition: r.edition || '', grade: r.grade || '', volume: r.volume || '',
      note: r.note || '', cover_path: r.cover_path || ''
    })
    setCoverFile(null); setDialog(true)
  }

  const save = async () => {
    if (!form.name.trim()) return toast('请填写课本名称', 'err')
    setBusy(true)
    try {
      const id = await upsertTextbook({
        name: form.name.trim(), subject_id: form.subject_id || null,
        publisher: form.publisher.trim(), edition: form.edition.trim(),
        grade: form.grade.trim(), volume: form.volume.trim(),
        note: form.note.trim(), cover_path: form.cover_path || null
      }, editing || undefined)
      if (coverFile) {
        const path = await uploadTextbookCover(id, coverFile)
        await upsertTextbook({ cover_path: path }, id)
      }
      toast(editing ? '课本已更新' : '课本已创建', 'ok')
      setDialog(false); await load()
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const askDelete = async (r: Textbook) => {
    try {
      const i = await textbookDeleteImpact(r.id)
      setDel({
        id: r.id, name: r.name,
        impact: `该课本下有 ${i.chapters} 个章节、${i.materials} 份课本材料、${i.kps} 条知识点映射、${i.links} 条错题关联。删除后课本、章节与材料都会进统一回收站（30 天内可恢复），但知识点/错题关联会随章节一起不再参与抽题；错题本身不会被删除。`
      })
    } catch (e: any) { toast('读取影响范围失败：' + e.message, 'err') }
  }
  const doDelete = async () => {
    if (!del) return
    setBusy(true)
    try {
      await softDeleteTextbookWithRelations(del.id)
      toast('已移入回收站：课本 / 章节 / 材料（30 天内可恢复）', 'ok')
      setDel(null); await load()
    } catch (e: any) { toast('删除失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800"><Library size={20} className="text-brand-600" /> 课本管理</h1>
          <p className="muted">按科目维护课本与版本；课本数据完全由你自己录入或上传，AI 不会联网搜课本。</p>
        </div>
        <button className="btn-primary" onClick={openNew}><Plus size={16} /> 新建课本</button>
        <Link href="/review/random" className="btn-ghost"><BookOpen size={15} /> 去组卷</Link>
      </div>

      <div className="card grid gap-3 p-3 sm:grid-cols-3">
        <div><label className="label">科目筛选</label>
          <select className="input" value={filter.subject_id} onChange={(e) => setFilter((f) => ({ ...f, subject_id: e.target.value }))}>
            <option value="">全部科目</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label className="label">年级筛选</label>
          <select className="input" value={filter.grade} onChange={(e) => setFilter((f) => ({ ...f, grade: e.target.value }))}>
            <option value="">全部年级</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></div>
        <div><label className="label">版本筛选</label>
          <select className="input" value={filter.edition} onChange={(e) => setFilter((f) => ({ ...f, edition: e.target.value }))}>
            <option value="">全部版本</option>{editions.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">还没有课本。点「新建课本」，填科目、出版社/版本、年级、册次，然后进入章节树导入目录。</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start gap-3">
                {r.cover_path && covers[r.cover_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={covers[r.cover_path]} alt="封面" className="h-16 w-12 shrink-0 rounded border object-cover" />
                ) : <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded border bg-slate-50 text-slate-300"><Library size={20} /></div>}
                <div className="min-w-0 flex-1">
                  <Link href={`/textbooks/${r.id}`} className="block truncate font-semibold text-slate-800 hover:text-brand-700">{r.name}</Link>
                  <div className="mt-1 text-xs text-slate-500">
                    {r.subject?.name || '未设科目'} · {r.grade || '—'} · {r.volume || '—'}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-400">{r.publisher || '未填出版社'} {r.edition && `· ${r.edition}`}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500"><Layers size={13} /> {r.chapterCount || 0} 个章节</div>
              {r.note && <p className="line-clamp-2 text-xs text-slate-400">{r.note}</p>}
              <div className="mt-auto flex gap-2 pt-2">
                <Link href={`/textbooks/${r.id}`} className="btn-ghost flex-1 py-1.5 text-xs">章节与材料</Link>
                <button className="btn-ghost py-1.5 text-xs" onClick={() => openEdit(r)} title="编辑"><Pencil size={14} /></button>
                <button className="btn-ghost py-1.5 text-xs text-rose-600" onClick={() => void askDelete(r)} title="删除"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setDialog(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800">{editing ? '编辑课本' : '新建课本'}</h2>
            <p className="muted mt-1">版本由你选择，系统不会自动识别课本版本。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label">课本名称 *</label>
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="如：高中数学必修一" /></div>
              <div><label className="label">科目</label>
                <select className="input" value={form.subject_id} onChange={(e) => set('subject_id', e.target.value)}>
                  <option value="">未设置</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div><label className="label">出版社</label>
                <input className="input" value={form.publisher} onChange={(e) => set('publisher', e.target.value)} placeholder="如：人民教育出版社" /></div>
              <div><label className="label">版本</label>
                <input className="input" value={form.edition} onChange={(e) => set('edition', e.target.value)} placeholder="如：2019 人教A版" /></div>
              <div><label className="label">年级</label>
                <input className="input" value={form.grade} onChange={(e) => set('grade', e.target.value)} placeholder="如：高一" /></div>
              <div><label className="label">册次</label>
                <input className="input" value={form.volume} onChange={(e) => set('volume', e.target.value)} placeholder="如：必修第一册 / 上册" /></div>
              <div className="sm:col-span-2"><label className="label">备注</label>
                <textarea className="input min-h-[60px]" value={form.note} onChange={(e) => set('note', e.target.value)} /></div>
              <div className="sm:col-span-2">
                <label className="label">封面图（可选，压缩后存 Storage，数据库只记路径）</label>
                <label className="btn-ghost inline-flex cursor-pointer py-1.5 text-xs">
                  <ImagePlus size={14} /> 选择图片
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
                </label>
                <span className="ml-2 text-xs text-slate-400">{coverFile?.name || (form.cover_path ? '已有封面，可更换' : '未上传')}</span>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDialog(false)}>取消</button>
              <button className="btn-primary" disabled={busy} onClick={() => void save()}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} 保存
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!del} title={`删除课本「${del?.name || ''}」？`} busy={busy}
        description={del?.impact || ''} confirmText="移入回收站" requireText="删除" onConfirm={doDelete} onClose={() => setDel(null)} />
    </div>
  )
}
