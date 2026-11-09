'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Sparkles, ScanText, History, RotateCcw, Check, X, Loader2, Trash2, Printer, FileImage, Crop } from 'lucide-react'
import { RichTextEditor } from './editor/RichTextEditor'
import { ImageUploader, type LocalImage } from './editor/ImageUploader'
import { FullPageCaptureDialog } from './FullPageCaptureDialog'
import { LegacyImageNotice } from './LegacyImageNotice'
import { useAi } from './AiProvider'
import { useToast } from './Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { offlineGuard, useOnline } from './OnlineStatus'
import { CAUSES, MASTERY_LABEL, type AiOrganizeResult, type Cause, type Mastery, type Mistake, type MistakeInput, type OcrResult } from '@/types'
import {
  upsertMistake, setMistakeTags, uploadMistakeImage, deleteMistakeImage,
  listSubjects, listBooks, listTags, quickCreate, listVersions, rollbackVersion,
  bindDraftImages, countCroppedChildren
} from '@/lib/data'
import { fmtDateTime, toDateInput, uid } from '@/lib/utils'
import { runLocalOcr, type LocalOcrProgress } from '@/lib/ocr/local-ocr'
import type { CaptureApplyPayload } from '@/types'

const EMPTY: MistakeInput = {
  title: '', content: '', answer: '', analysis: '', knowledge_points: [], cause: '其他',
  difficulty: 3, source: '', mastery: 'unmastered', mistake_date: toDateInput(new Date()),
  next_review_at: new Date().toISOString(), book_id: null, subject_id: null
}

export function MistakeForm({ initial, id }: { initial?: Mistake; id?: string }) {
  const router = useRouter()
  const toast = useToast()
  const ai = useAi()
  const online = useOnline()
  const [form, setForm] = useState<MistakeInput>(() => initial ? {
    title: initial.title, content: initial.content, answer: initial.answer, analysis: initial.analysis,
    knowledge_points: initial.knowledge_points, cause: initial.cause, difficulty: initial.difficulty,
    source: initial.source, mastery: initial.mastery, mistake_date: initial.mistake_date,
    next_review_at: initial.next_review_at, book_id: initial.book_id, subject_id: initial.subject_id
  } : EMPTY)
  const [tagNames, setTagNames] = useState<string[]>(initial?.tags?.map((t) => t.name) || [])
  const [images, setImages] = useState<LocalImage[]>(() => (initial?.images || []).map((i) => ({
    key: i.id, preview: i.signedUrl || '', storagePath: i.storage_path, dbId: i.id,
    role: (i.image_role || 'inline') as LocalImage['role'],
    parentImageId: i.parent_image_id || undefined, uploaded: true
  })))
  /** 新建页先上传整题图时用的临时实体 id，保存错题后回填 mistake_id */
  const [draftId] = useState(() => uid())
  const [captureOpen, setCaptureOpen] = useState(false)
  /** v4：删除整题原图的二次确认状态（含裁剪图引用数） */
  const [pendingDelete, setPendingDelete] = useState<{ img: LocalImage; children: number } | null>(null)
  const [subjects, setSubjects] = useState<any[]>([])
  const [books, setBooks] = useState<any[]>([])
  const [allTags, setAllTags] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [localOcrBusy, setLocalOcrBusy] = useState(false)
  const [localOcrProgress, setLocalOcrProgress] = useState<LocalOcrProgress | null>(null)
  const [ocrSource, setOcrSource] = useState<'ai' | 'local'>('ai')
  const [ocrNote, setOcrNote] = useState('')
  const [aiResult, setAiResult] = useState<AiOrganizeResult | null>(null)
  const [ocr, setOcr] = useState<OcrResult | null>(null)
  const [versions, setVersions] = useState<any[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [draftTip, setDraftTip] = useState('')

  const draftKey = `mistake-draft-${id || 'new'}`

  useEffect(() => {
    void Promise.all([listSubjects(), listBooks(), listTags()])
      .then(([s, b, t]) => { setSubjects(s); setBooks(b); setAllTags(t) })
      .catch(() => {})
    if (id) void listVersions(id).then(setVersions)
    // 草稿恢复提示
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw && !initial) setDraftTip('检测到上次未保存的草稿，可点击「恢复草稿」')
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 自动保存草稿（不含图片，避免 localStorage 溢出）
  useEffect(() => {
    if (saving) return
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ form, tagNames, at: Date.now() })) } catch {}
    }, 800)
    return () => clearTimeout(t)
  }, [form, tagNames, draftKey, saving])

  const set = <K extends keyof MistakeInput>(k: K, v: MistakeInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw)
      setForm(d.form); setTagNames(d.tagNames || [])
      setDraftTip(''); toast('草稿已恢复', 'ok')
    } catch { toast('草稿恢复失败', 'err') }
  }

  const save = async () => {
    if (!offlineGuard(online, toast)) return
    if (!form.title?.trim() && !form.content?.trim()) { toast('请至少填写标题或题目正文', 'err'); return }
    setSaving(true)
    try {
      const mistakeId = await upsertMistake(form, id)
      // v4：把新建页「整题上传」时先传到云端的图绑定到这道题（不重复上传）
      if (!id) await bindDraftImages(draftId, mistakeId)
      // 上传新增图片
      const kept: LocalImage[] = []
      for (const img of images) {
        if (img.file) {
          const row = await uploadMistakeImage(mistakeId, img.file, kept.length)
          kept.push({ ...img, file: undefined, dbId: row.id, storagePath: row.storage_path })
        } else kept.push(img)
      }
      // 删除被移除的旧图
      const oldIds = (initial?.images || []).map((i) => i.id)
      for (const oid of oldIds) if (!kept.some((k) => k.dbId === oid)) await deleteMistakeImage(oid)
      setImages(kept)
      await setMistakeTags(mistakeId, tagNames)
      try { localStorage.removeItem(draftKey) } catch {}
      toast('已保存到云端', 'ok')
      if (!id) router.push(`/mistakes/${mistakeId}`)
      else router.refresh()
    } catch (e: any) { toast(`保存失败：${e?.message || '请检查网络与图片权限'}`, 'err') }
    finally { setSaving(false) }
  }

  // ---------------- AI 整理（先预览，确认后才填进编辑区） ----------------
  const runAi = async () => {
    if (!ai.can('organize')) { toast(ai.reason('organize'), 'err'); return }
    setAiBusy(true)
    try {
      const dataUrls = images.map((i) => i.dataUrl).filter(Boolean).slice(0, 4) as string[]
      const r = await fetch('/api/ai/organize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mistakeId: id, title: form.title, content: form.content, answer: form.answer, analysis: form.analysis,
          images: dataUrls, customTemplate: undefined
        })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'AI 整理失败')
      setAiResult(j.result)
      toast(j.cached ? '命中缓存，未产生新的 AI 调用' : '整理完成，请先预览再确认应用', 'ok')
    } catch (e: any) { toast(`AI整理失败：${e?.message || '请稍后重试'}`, 'err') }
    finally { setAiBusy(false) }
  }

  const applyAi = () => {
    if (!aiResult) return
    const stepsHtml = aiResult.steps.length ? `<h2>解题步骤</h2><ol>${aiResult.steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : ''
    const answersHtml = aiResult.answerPoints.length ? `<h2>答案要点</h2><ul>${aiResult.answerPoints.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''
    setForm((f) => ({
      ...f,
      title: f.title?.trim() || aiResult.normalizedStem.slice(0, 40) || 'AI 整理错题',
      content: `<p>${aiResult.normalizedStem}</p>` + (f.content && f.content !== '<p></p>' ? `<h2>原题（保留）</h2>${f.content}` : ''),
      answer: answersHtml || f.answer,
      analysis: stepsHtml || f.analysis,
      knowledge_points: [...new Set([...(f.knowledge_points || []), ...aiResult.knowledgePoints])],
      cause: aiResult.cause, difficulty: aiResult.difficulty,
      ai_result: aiResult, ai_applied_at: new Date().toISOString(),
      similar_questions: aiResult.similarQuestions
    }))
    setTagNames((t) => [...new Set([...t, ...aiResult.tags])])
    setAiResult(null)
    toast('已填入编辑区（尚未保存）。请检查后再点「保存」，或到历史版本回滚', 'ok')
  }

  // ---------------- OCR（结果先进预览区，不自动写入） ----------------
  const runOcr = async (dataUrl: string) => {
    if (!ai.can('ocr')) { toast(ai.reason('ocr'), 'err'); return }
    setOcrBusy(true)
    try {
      const r = await fetch('/api/ai/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, mistakeId: id })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'OCR 失败')
      setOcr(j.result); setOcrSource('ai'); setOcrNote('')
      toast(j.cached ? '命中 OCR 缓存' : '识别完成，请确认后再填入', 'ok')
    } catch (e: any) {
      // 失败时保留原图，不阻塞手动录入
      toast(`OCR失败：${e?.message || '可手动录入，原图已保留'}`, 'err')
    } finally { setOcrBusy(false) }
  }

  // ---------------- 本地 OCR（浏览器 WASM，零外部 AI 调用、零费用） ----------------
  const runLocalOcrHandler = async (dataUrl: string) => {
    if (localOcrBusy) return
    setLocalOcrBusy(true)
    setLocalOcrProgress({ stage: '正在启动本地识别引擎', progress: 0 })
    try {
      const r = await runLocalOcr(dataUrl, { onProgress: setLocalOcrProgress })
      setOcr({ text: r.text, formulas: r.formulas, rawText: r.lang })
      setOcrSource('local'); setOcrNote(r.note)
      toast(r.text ? '本地识别完成（未联网调用 AI），请核对修改后再填入' : '未识别到文字，原图已保留，可直接手动录入', r.text ? 'ok' : 'err')
    } catch (e: any) {
      // 失败不阻塞录题：原图仍在，用户可手动输入
      toast(`本地 OCR 失败：${e?.message || '可手动录入，原图已保留'}`, 'err')
    } finally { setLocalOcrBusy(false); setLocalOcrProgress(null) }
  }

  const applyOcr = () => {
    if (!ocr) return
    const safe = (ocr.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const formulaHtml = ocr.formulas.length ? '<p>' + ocr.formulas.join(' ') + '</p>' : ''
    setForm((f) => ({ ...f, content: (f.content || '') + `<p>${safe.replace(/\n/g, '<br/>')}</p>` + formulaHtml }))
    setOcr(null); toast('识别文字已填入题目正文，请核对后保存', 'ok')
  }

  const doRollback = async (v: any) => {
    if (!id) return
    if (!window.confirm(`回滚到第 ${v.version_no} 版？当前内容会先自动存为一个新版本，可再回滚回来。`)) return
    try {
      await rollbackVersion(id, v)
      toast('已回滚，请刷新页面查看', 'ok')
      setTimeout(() => window.location.reload(), 800)
    } catch (e: any) { toast('回滚失败：' + e.message, 'err') }
  }

  // ---------------- v4：整题拍照上传 / OCR 预览 / 裁剪 ----------------
  const handleCaptureApply = (p: CaptureApplyPayload) => {
    if (p.html) {
      setForm((f) => ({ ...f, [p.targetField]: (f[p.targetField] || '') + p.html }))
    }
    const next: LocalImage[] = p.images.map((im) => ({
      key: im.id,
      preview: im.signedUrl,
      storagePath: im.storage_path,
      dbId: im.id,
      role: im.image_role,
      parentImageId: im.parent_image_id || undefined,
      uploaded: true
    }))
    setImages((prev) => [...prev, ...next.filter((n) => !prev.some((x) => x.dbId === n.dbId))])
  }

  /** 点击「删除」：先查裁剪图引用，再弹出应用内确认框（取消 / 继续删除 两个按钮） */
  const askRemoveOriginal = async (img: LocalImage) => {
    const localChildren = images.filter((i) => i.parentImageId === img.dbId).length
    let dbChildren = 0
    if (img.dbId && id) { try { dbChildren = await countCroppedChildren(img.dbId) } catch {} }
    setPendingDelete({ img, children: Math.max(localChildren, dbChildren) })
  }
  /** 确认删除：进入图片回收站，Storage 文件不立即物理删除（原图不会因裁剪被删） */
  const confirmRemoveOriginal = async () => {
    const img = pendingDelete?.img
    if (!img) return
    try {
      if (img.dbId && img.uploaded) await deleteMistakeImage(img.dbId)
      setImages((prev) => prev.filter((i) => i.key !== img.key))
      toast('整题原图已移入回收站（云端文件保留，可恢复）', 'ok')
    } catch (e: any) { toast(`删除失败：${e?.message || '请稍后重试'}`, 'err') }
    finally { setPendingDelete(null) }
  }

  /** 把裁剪图以「Storage 路径」插入题干，绝不写 Base64 */
  const insertCroppedIntoContent = (img: LocalImage) => {
    if (!img.storagePath) return
    setForm((f) => ({
      ...f,
      content: (f.content || '') + `<p><img data-storage-path="${img.storagePath}" alt="手动裁剪图"></p>`
    }))
    toast('裁剪图已插入题干（只存云端路径，展示/打印时自动签名）', 'ok')
  }

  const originals = images.filter((i) => i.role === 'original')
  const cropped = images.filter((i) => i.role === 'cropped')

  const aiDisabledReason = ai.loading ? '检测中…' : ai.reason('organize')

  return (
    <div className="space-y-4">
      {/* 顶部操作条 */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCaptureOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
          <FileImage size={16} /> 拍照 / 上传整题
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 保存到云端
        </button>
        <button className="btn-ghost" onClick={runAi} disabled={!ai.can('organize') || aiBusy}
          title={aiDisabledReason}>
          {aiBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} AI整理
        </button>
        {!ai.can('organize') && <span className="badge bg-slate-100 text-slate-400">{aiDisabledReason}</span>}
        {id && <button className="btn-ghost" onClick={() => setShowVersions(!showVersions)}><History size={16} /> 历史版本 {versions.length ? `(${versions.length})` : ''}</button>}
        {id && <button className="btn-ghost" onClick={() => router.push(`/print?ids=${id}`)}><Printer size={16} /> 单题打印</button>}
        {!online && <span className="badge bg-amber-50 text-amber-700">离线中，暂不能保存</span>}
      </div>

      {/* v4：历史 Base64 富文本图片提示 + 迁移入口（新图不会再产生 Base64） */}
      {id && (
        <LegacyImageNotice mistakeId={id}
          html={{ content: form.content || '', answer: form.answer || '', analysis: form.analysis || '' }}
          onMigrated={(f) => setForm((prev) => ({ ...prev, ...f }))} />
      )}

      {/* v4：整题原图醒目展示 + OCR 文字对照说明 */}
      {originals.length > 0 && (
        <div className="card border-emerald-200 bg-emerald-50/40 p-4">
          <h3 className="section-title flex items-center gap-2"><FileImage size={17} className="text-emerald-700" /> 整题原图（{originals.length} 张）</h3>
          <p className="muted mt-1">原图与 OCR 文字是两条独立记录：改题干不会影响原图；打印默认打印整题原图；删除需二次确认。</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {originals.map((img) => (
              <div key={img.key} className="rounded-lg border border-emerald-200 bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.preview} alt="整题原图" loading="lazy" className="max-h-52 w-full rounded object-contain" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                  <span className="badge bg-emerald-100 text-emerald-800">整题原图</span>
                  <button type="button" className="text-xs text-rose-600 hover:underline no-print" onClick={() => void askRemoveOriginal(img)}>删除（二次确认）</button>
                </div>
              </div>
            ))}
          </div>
          {cropped.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
              <div className="text-xs font-semibold text-slate-600"><Crop size={13} className="mr-1 inline" />手动裁剪图 {cropped.length} 张（可插入题干，原图不因裁剪被删）</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {cropped.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 rounded border border-slate-200 p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.preview} alt="裁剪图" loading="lazy" className="h-12 w-12 rounded object-cover" />
                    <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => insertCroppedIntoContent(c)}>插入题干</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {draftTip && (
        <div className="no-print flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>已自动保存草稿 · {draftTip}</span>
          <button className="font-medium underline" onClick={restoreDraft}>恢复草稿</button>
        </div>
      )}

      {/* AI 整理预览：必须用户点「确认应用」才写入 */}
      {aiResult && (
        <div className="no-print card border-brand-200 p-4">
          <div className="flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2"><Sparkles size={17} className="text-brand-600" /> AI 整理结果预览（尚未写入）</h3>
            <button className="text-slate-400" onClick={() => setAiResult(null)}><X size={17} /></button>
          </div>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <Preview label="规范化题干" value={aiResult.normalizedStem} />
            <Preview label="知识点" value={aiResult.knowledgePoints.join('、')} />
            <Preview label="错因 / 难度" value={`${aiResult.cause} / ${aiResult.difficulty} 星`} />
            <Preview label="标签建议" value={aiResult.tags.join('、')} />
            <Preview label="解题步骤" value={aiResult.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')} />
            <Preview label="答案要点" value={aiResult.answerPoints.join('\n')} />
            <Preview label="复习建议" value={aiResult.reviewAdvice} />
            <Preview label="相似题（AI生成，需核对）" value={aiResult.similarQuestions.join('\n')} warn />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={applyAi}><Check size={16} /> 确认应用（填入编辑区，仍需点保存）</button>
            <button className="btn-ghost" onClick={() => setAiResult(null)}>放弃</button>
            <span className="muted">应用后仍可到「历史版本」回滚，不会直接覆盖原内容</span>
          </div>
        </div>
      )}

      {/* OCR 预览：可直接在编辑区改错字，确认后才写入题目正文 */}
      {ocr && (
        <div className="no-print card border-emerald-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="section-title flex items-center gap-2"><ScanText size={17} className="text-emerald-600" /> OCR 识别结果（可直接修改，确认后才填入）</h3>
            <div className="flex items-center gap-2">
              <span className={`badge ${ocrSource === 'local' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-50 text-brand-700'}`}>
                {ocrSource === 'local' ? '本地 OCR（离线免费 · 未调用 AI）' : 'AI OCR（Coding Plan 视觉模型）'}
              </span>
              <button className="text-slate-400" onClick={() => setOcr(null)}><X size={17} /></button>
            </div>
          </div>
          <textarea className="input mt-3 min-h-[160px] whitespace-pre-wrap font-mono text-sm"
            value={ocr.text || ''} placeholder="(未识别到文字，可手动录入，原图已保留)"
            onChange={(e) => setOcr({ ...ocr, text: e.target.value })} />
          {ocr.formulas.length > 0 && <div className="mt-2 text-sm text-slate-500">疑似公式（文本形式）：{ocr.formulas.join('  ')}</div>}
          {ocrNote && <p className="mt-2 text-xs text-amber-700">⚠ {ocrNote}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={applyOcr}><Check size={16} /> 填入题目正文</button>
            <button className="btn-ghost" onClick={() => setOcr(null)}>放弃</button>
            <span className="muted self-center text-xs">填入后仍需点「保存到云端」才会写入数据库</span>
          </div>
        </div>
      )}

      {/* 历史版本 */}
      {showVersions && (
        <div className="no-print card p-4">
          <h3 className="section-title flex items-center gap-2"><History size={16} /> 历史版本（每次保存自动留档）</h3>
          {versions.length === 0 ? <p className="muted mt-2">暂无历史版本，修改并保存后会自动生成。</p> : (
            <ul className="mt-3 divide-y text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2">
                  <span>第 {v.version_no} 版 · {fmtDateTime(v.created_at)} · {v.change_note}</span>
                  <button className="btn-ghost" onClick={() => doRollback(v)}><RotateCcw size={14} /> 回滚</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 基础字段 */}
      <div className="card p-4">
        <h3 className="section-title">基本信息</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">标题 *</label>
            <input className="input" value={form.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="例如：二次函数最值问题" />
          </div>
          <Field label="科目">
            <select className="input" value={form.subject_id || ''} onChange={(e) => set('subject_id', e.target.value || null)}>
              <option value="">未分类</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="错题本">
            <select className="input" value={form.book_id || ''} onChange={(e) => set('book_id', e.target.value || null)}>
              <option value="">默认</option>{books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="错因">
            <select className="input" value={form.cause} onChange={(e) => set('cause', e.target.value as Cause)}>
              {CAUSES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="难度 1-5">
            <select className="input" value={form.difficulty} onChange={(e) => set('difficulty', Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'★'.repeat(d)} ({d})</option>)}
            </select>
          </Field>
          <Field label="掌握状态">
            <select className="input" value={form.mastery} onChange={(e) => set('mastery', e.target.value as Mastery)}>
              {Object.entries(MASTERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="错题发生日期">
            <input className="input" type="date" value={form.mistake_date || ''} onChange={(e) => set('mistake_date', e.target.value)} />
          </Field>
          <Field label="下次复习时间">
            <input className="input" type="datetime-local" value={form.next_review_at ? new Date(form.next_review_at).toISOString().slice(0, 16) : ''}
              onChange={(e) => set('next_review_at', e.target.value ? new Date(e.target.value).toISOString() : new Date().toISOString())} />
          </Field>
          <Field label="来源">
            <input className="input" value={form.source || ''} onChange={(e) => set('source', e.target.value)} placeholder="期中卷 / 教辅 P32" />
          </Field>
          <Field label="知识点（逗号分隔）">
            <input className="input" value={(form.knowledge_points || []).join('、')} onChange={(e) => set('knowledge_points', e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))} placeholder="二次函数、配方法" />
          </Field>
          <Field label="标签（逗号分隔）">
            <input className="input" value={tagNames.join('、')} onChange={(e) => setTagNames(e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))} placeholder="易错、压轴题" list="tag-options" />
            <datalist id="tag-options">{allTags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button className="chip" onClick={async () => { const n = prompt('新科目名称'); if (n) { await quickCreate('subjects', n); setSubjects(await listSubjects()) } }}>+ 新科目</button>
          <button className="chip" onClick={async () => { const n = prompt('新错题本名称'); if (n) { await quickCreate('mistake_books', n); setBooks(await listBooks()) } }}>+ 新错题本</button>
        </div>
      </div>

      {/* 正文 / 答案 / 解析 */}
      <div className="card p-4">
        <h3 className="section-title">题目正文（富文本 · 公式 · 表格）</h3>
        <div className="mt-2"><RichTextEditor value={form.content || ''} onChange={(h) => set('content', h)} /></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">答案（支持 $公式$）</label>
            <textarea className="input min-h-[110px]" value={form.answer || ''} onChange={(e) => set('answer', e.target.value)} placeholder="x = 2" />
          </div>
          <div>
            <label className="label">解析 / 错因复盘</label>
            <textarea className="input min-h-[110px]" value={form.analysis || ''} onChange={(e) => set('analysis', e.target.value)} placeholder="错在忘记讨论判别式…" />
          </div>
        </div>
      </div>

      {/* 图片：普通富文本插图，与上方「整题上传」明确区分 */}
      <div className="card p-4">
        <h3 className="section-title">插入图片（普通插图 · 可多张 · 自动压缩）</h3>
        <p className="muted mt-1">
          手机点「拍照」调用相机，也可从相册选、拖拽或 Ctrl+V 粘贴；压缩后存云端私有桶，数据库只记录路径。
          <b className="text-emerald-700">要整张试卷/整道题拍照并自动 OCR，请点页面顶部绿色的「拍照 / 上传整题」，两者互不影响。</b>
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="badge bg-emerald-50 text-emerald-700">绿色 <b>本地 OCR</b>：图片上的「扫描线」按钮 · 浏览器离线识别中英文 · 免费 · 不调用 AI</span>
          <span className={`badge ${ai.can('ocr') ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-400'}`}>
            蓝色 <b>AI OCR</b>：{ai.can('ocr') ? '可用，调用 Coding Plan 视觉模型，识别公式更准' : `已禁用（${ai.reason('ocr')}）`}
          </span>
        </div>
        <div className="mt-3">
          <ImageUploader value={images} onChange={setImages} onOcr={runOcr} canOcr={ai.can('ocr')} ocrBusy={ocrBusy}
            onLocalOcr={runLocalOcrHandler} localOcrBusy={localOcrBusy} />
        </div>
        {localOcrBusy && localOcrProgress && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <div className="flex items-center justify-between"><span>{localOcrProgress.stage}</span><span>{Math.round(localOcrProgress.progress * 100)}%</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.max(3, localOcrProgress.progress * 100)}%` }} />
            </div>
            <p className="mt-1.5">首次使用需下载约 16MB 中文+英文语言包，弱网可能等 30–60 秒；下载后会缓存，之后离线也能识别。期间请勿关闭页面。</p>
          </div>
        )}
        {!ai.can('ocr') && (
          <p className="mt-2 text-xs text-slate-500">
            AI OCR 不可用（{ai.reason('ocr')}）。<b className="text-emerald-700">本地 OCR 仍然可用</b>：点图片上的绿色扫描线按钮即可，不消耗任何 AI 额度；图片上传与手动录入也照常。
          </p>
        )}
      </div>

      <div className="no-print flex justify-end gap-2 pb-6">
        <button className="btn-ghost" onClick={() => router.push('/mistakes')}>返回列表</button>
        <button className="btn-primary" onClick={save} disabled={saving}><Save size={16} /> 保存到云端</button>
      </div>

      {/* 整题拍照上传 → OCR 预览 → 确认应用 工作区 */}
      <FullPageCaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)}
        onApply={handleCaptureApply} mistakeId={id} draftId={draftId} />

      {/* v4：删除整题原图二次确认（含裁剪图引用提示） */}
      <ConfirmDialog open={!!pendingDelete}
        title="删除整题原图？"
        description={pendingDelete ? (
          pendingDelete.children
            ? `该原图有 ${pendingDelete.children} 张裁剪图关联，删除后裁剪图仍保留，是否继续？`
            : '确定删除这张整题原图吗？删除后会进入回收站，30 天内可恢复；彻底删除时才会清除云端文件。'
        ) : ''}
        confirmText="继续删除" danger onConfirm={confirmRemoveOriginal} onClose={() => setPendingDelete(null)} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>
}
function Preview({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${warn ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{value || '—'}</div>
      {warn && <div className="mt-1 text-xs font-medium">⚠ AI生成，需核对，不能当作标准题使用</div>}
    </div>
  )
}
