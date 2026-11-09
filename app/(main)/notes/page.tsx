'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  StickyNote, Plus, Search, Trash2, Pencil, Share2, History, RotateCcw,
  Sparkles, BookOpen, CalendarDays, Loader2, Check, X, Copy
} from 'lucide-react'
import {
  listNotes, getNote, upsertNote, softDelete, listNoteVersions, rollbackNote,
  createNoteShare, uploadNoteImages, hydrateNoteHtml
} from '@/lib/data-v2'
import { listMistakes } from '@/lib/data'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { ImageUploader, type LocalImage } from '@/components/editor/ImageUploader'
import { AiOnly, useAi } from '@/components/AiProvider'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { renderMath, sanitizeHtml, fmtDateTime } from '@/lib/utils'
import type { Note, NoteInput, NoteVersion, NoteSummaryResult } from '@/types'

export default function NotesPage() {
  const toast = useToast()
  const ai = useAi()
  const [rows, setRows] = useState<Note[]>([])
  const [q, setQ] = useState('')
  const [form, setForm] = useState<NoteInput | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [images, setImages] = useState<LocalImage[]>([])
  const [renderHtml, setRenderHtml] = useState('')
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState<{ id: string; title: string }[]>([])
  const [aiPreview, setAiPreview] = useState<NoteSummaryResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  const load = () => void listNotes(q).then(setRows).catch((e: any) => toast(e.message, 'err'))
  useEffect(load, [q])
  useEffect(() => {
    void listMistakes({ pageSize: 100 }).then((r) => setMistakes(r.rows.map((m) => ({ id: m.id, title: m.title })))).catch(() => {})
    const edit = new URLSearchParams(window.location.search).get('edit')
    if (new URLSearchParams(window.location.search).get('new') === '1') openNew()
    else if (edit) void openEdit(edit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openNew = () => {
    setEditId(null); setForm({ title: '', content: '', tags: [], summary: '', mistake_id: null })
    setImages([]); setRenderHtml(''); setVersions([]); setShowVersions(false); setAiPreview(null)
  }
  const openEdit = async (id: string) => {
    try {
      const n = await getNote(id)
      setEditId(id)
      setForm({ title: n.title, content: n.content, tags: n.tags || [], summary: n.summary || '', mistake_id: n.mistake_id })
      setImages([...n.content.matchAll(/data-storage-path="([^"]+)"/g)].map((m, i) => ({
        key: `saved-${i}`, preview: '', storagePath: m[1]
      })) as LocalImage[])
      setRenderHtml(renderMath(await hydrateNoteHtml(sanitizeHtml(n.content))))
      setVersions(await listNoteVersions(id)); setAiPreview(null)
    } catch (e: any) { toast('打开笔记失败：' + e.message, 'err') }
  }

  const save = async () => {
    if (!form) return
    if (!form.title?.trim()) return toast('请填写笔记标题', 'err')
    setSaving(true)
    try {
      let html = sanitizeHtml(form.content || '')
      // 去掉展示时临时注入的签名 src，只保留持久化的 data-storage-path
      html = html.replace(/\s+src="https:\/\/[^"]*"/g, '')
      const tags = typeof form.tags === 'string'
        ? (form.tags as unknown as string).split(/[,，#]/).map((s) => s.trim()).filter(Boolean)
        : (form.tags || [])
      const id = await upsertNote({ ...form, content: html, tags }, editId || undefined)
      const newFiles = images.filter((i) => i.file).map((i) => i.file as File)
      if (newFiles.length) {
        const paths = await uploadNoteImages(id, newFiles)
        html += paths.map((p) => `<p><img data-storage-path="${p}" alt="笔记图片"></p>`).join('')
        await upsertNote({ content: html }, id)
        setEditId(id)
      }
      toast(editId ? '笔记已更新（旧版本已自动留存）' : '笔记已创建', 'ok')
      setForm(null); setImages([]); setRenderHtml(''); load()
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setSaving(false) }
  }

  const runSummary = async () => {
    if (!form?.content) return toast('先写点内容再让 AI 总结', 'err')
    setAiBusy(true)
    try {
      const r = await fetch('/api/ai/note-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, content: form.content })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'AI 总结失败')
      setAiPreview(j.result as NoteSummaryResult)
      toast('总结已生成，确认后才会写入笔记', 'ok')
    } catch (e: any) { toast(e.message, 'err') }
    finally { setAiBusy(false) }
  }

  const share = async (id: string) => {
    try {
      const url = await createNoteShare(id, 7)
      await navigator.clipboard.writeText(url)
      toast('只读分享链接已复制（7 天后过期，可在设置里随时取消）', 'ok')
    } catch (e: any) { toast('分享失败：' + e.message, 'err') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">笔记</h1><p className="muted">富文本 · 公式 · 表格 · 图片 · 标签 · 历史版本 · 只读分享 · 关联错题</p></div>
        <Link href="/search" className="btn-ghost"><Search size={15} /> 统一搜索</Link>
        <button className="btn-primary" onClick={openNew}><Plus size={16} /> 新建笔记</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* 左：列表 */}
        <div className="space-y-2">
          <div className="card flex items-center gap-2 p-2">
            <Search size={15} className="text-slate-400" />
            <input className="input border-0 py-1 focus:ring-0" placeholder="搜索标题 / 正文 / 摘要" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="card max-h-[70vh] divide-y overflow-y-auto">
            {rows.length === 0 && <p className="p-4 text-center text-xs text-slate-400">还没有笔记</p>}
            {rows.map((n) => (
              <button key={n.id} onClick={() => void openEdit(n.id)}
                className={`block w-full p-3 text-left transition hover:bg-brand-50/50 ${editId === n.id ? 'bg-brand-50' : ''}`}>
                <div className="truncate text-sm font-medium text-slate-700">{n.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{n.summary || n.content.replace(/<[^>]*>/g, ' ').slice(0, 60)}</div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                  {fmtDateTime(n.updated_at)} {n.tags?.slice(0, 2).map((t) => <span key={t} className="badge">#{t}</span>)}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 右：编辑 / 预览 */}
        <div className="card p-4">
          {!form ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
              <StickyNote size={34} className="text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">从左侧选一篇笔记，或点「新建笔记」</p>
              <p className="mt-1 text-xs text-slate-400">关闭 AI 后编辑、图片、公式、版本、分享全部照常可用</p>
              <button className="btn-primary mt-4" onClick={openNew}><Plus size={15} /> 新建笔记</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className="input flex-1 text-base font-semibold" placeholder="笔记标题" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <button className="btn-primary" disabled={saving} onClick={save}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 保存</button>
                <button className="btn-ghost" onClick={() => { setForm(null); setRenderHtml('') }}><X size={15} /> 关闭</button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div><label className="label">标签（逗号分隔）</label>
                  <input className="input" value={Array.isArray(form.tags) ? form.tags.join(',') : String(form.tags || '')}
                    onChange={(e) => setForm({ ...form, tags: e.target.value as any })} placeholder="物理, 力学" /></div>
                <div><label className="label">关联错题</label>
                  <select className="input" value={form.mistake_id || ''} onChange={(e) => setForm({ ...form, mistake_id: e.target.value || null })}>
                    <option value="">不关联</option>
                    {mistakes.map((m) => <option key={m.id} value={m.id}>{m.title.slice(0, 40)}</option>)}
                  </select></div>
              </div>

              <RichTextEditor value={form.content || ''} onChange={(h) => setForm((f) => f ? { ...f, content: h } : f)} placeholder="写点什么… 支持加粗、列表、引用、代码块、表格与 $公式$" />

              <div>
                <label className="label">图片（手机可拍照 / 相册 / 拖拽 / 粘贴，自动压缩；保存后写入私有存储）</label>
                <ImageUploader value={images} onChange={setImages} />
              </div>

              {/* AI 笔记总结：总开关 + ai_note_summary 子开关双控，预览确认后才写入 */}
              <div className="rounded-lg border border-slate-200 p-3">
                <AiOnly cap="note" fallback={
                  <div className="text-xs text-slate-500"><Sparkles size={14} className="mr-1 inline" /> AI笔记总结：{ai.reason('note')}。手动编辑与保存完全正常。</div>
                }>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-ghost" disabled={aiBusy} onClick={runSummary}>
                      {aiBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 生成 AI 总结（先预览）
                    </button>
                    <span className="text-xs text-slate-400">结果不会自动写入，需点「确认应用」</span>
                  </div>
                </AiOnly>
                {aiPreview && (
                  <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3">
                    <div className="text-sm font-semibold text-brand-800">总结预览</div>
                    <p className="mt-1 text-sm text-slate-700">{aiPreview.summary}</p>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{(aiPreview.keyPoints || []).map((p, i) => <li key={i}>{p}</li>)}</ul>
                    <p className="mt-2 text-xs text-slate-500">建议标签：{(aiPreview.tags || []).join(' / ')} ｜ 复习建议：{aiPreview.reviewAdvice}</p>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-primary" onClick={() => {
                        setForm((f) => f ? {
                          ...f, summary: aiPreview.summary,
                          tags: [...new Set([...(Array.isArray(f.tags) ? f.tags : []), ...(aiPreview.tags || [])])]
                        } : f)
                        setAiPreview(null); toast('已填入编辑区，还需点「保存」才写入云端', 'ok')
                      }}><Check size={15} /> 确认应用</button>
                      <button className="btn-ghost" onClick={() => setAiPreview(null)}><X size={15} /> 放弃</button>
                    </div>
                  </div>
                )}
              </div>

              {/* 版本 / 分享 */}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {editId && <>
                  <button className="btn-ghost" onClick={() => setShowVersions(!showVersions)}><History size={15} /> 历史版本（{versions.length}）</button>
                  <button className="btn-ghost" onClick={() => share(editId)}><Share2 size={15} /> 生成只读分享链接</button>
                  {form.mistake_id && <Link href={`/mistakes/${form.mistake_id}`} className="btn-ghost"><BookOpen size={15} /> 查看关联错题</Link>}
                  <button className="btn-ghost text-rose-600" onClick={() => setConfirmId(editId)}><Trash2 size={15} /> 删除</button>
                </>}
                <Link href="/calendar" className="btn-ghost"><CalendarDays size={15} /> 关联日程</Link>
              </div>

              {showVersions && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <h3 className="text-sm font-semibold text-slate-700">历史版本（每次保存自动留档，可一键回滚）</h3>
                  {versions.length === 0 && <p className="mt-1 text-xs text-slate-400">暂无历史版本</p>}
                  <ul className="mt-2 space-y-1">
                    {versions.map((v) => (
                      <li key={v.id} className="flex items-center gap-2 text-xs">
                        <span className="flex-1">v{v.version_no} · {fmtDateTime(v.created_at)} · {String((v.snapshot as any).title || '')}</span>
                        <button className="btn-ghost py-1" onClick={async () => {
                          await rollbackNote(editId!, v); toast('已回滚，请确认后点保存', 'ok'); await openEdit(editId!); load()
                        }}><RotateCcw size={13} /> 回滚</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {renderHtml && (
                <div className="rounded-lg border p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-500">已保存内容预览（公式与图片渲染）</div>
                  <div className="tiptap" dangerouslySetInnerHTML={{ __html: renderMath(renderHtml) }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog open={!!confirmId} title="删除这篇笔记？" busy={false}
        description="笔记与历史版本会进入统一回收站，30 天内可恢复。"
        confirmText="移入回收站" onConfirm={async () => {
          if (confirmId) { await softDelete('note', confirmId); setConfirmId(null); setForm(null); load(); toast('已移入回收站', 'ok') }
        }} onClose={() => setConfirmId(null)} />
    </div>
  )
}
