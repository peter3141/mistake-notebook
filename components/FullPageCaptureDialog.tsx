'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Camera, Images, X, ScanLine, Loader2, ZoomIn, ZoomOut, RotateCw,
  Crop, Check, AlertTriangle, RefreshCw, FileImage, Info
} from 'lucide-react'
import { useAi } from './AiProvider'
import { useToast } from './Toast'
import { ImageCropper, type CropRectPx } from './ImageCropper'
import { uploadImagesBatch, uploadImage, type BatchProgress } from '@/lib/images/client'
import { cropFromDataUrl, validateImageFile } from '@/lib/images/compress'
import { runLocalOcr } from '@/lib/ocr/local-ocr'
import type { CaptureApplyPayload, CaptureItem, UploadedImage } from '@/types'

const MAX_FILES = 9
const MAX_OCR_RETRY = 1

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function uuid() {
  return crypto.randomUUID()
}

/**
 * 整题拍照上传 → OCR 预览 → 文字进题干 + 整图存附件 + 可选手动裁剪
 *
 * 铁律：
 *  - 原图永远保留，「整图作为附件保留」默认勾选且锁定（不能因为放弃 OCR 丢图）；
 *  - AI OCR 只在「总开关 + OCR 子开关 + Key/BaseURL 已配置」全部满足时自动触发；
 *  - OCR 结果必须先在这里预览，用户点「确认应用」才写入题干；
 *  - OCR 失败/AI 关闭：只保留原图 + 提示本地 OCR / 手动录入，绝不阻塞保存；
 *  - 重试不重复上传同一张图（服务端按 storagePath 缓存结果）。
 */
export function FullPageCaptureDialog({
  open, onClose, onApply, mistakeId, draftId
}: {
  open: boolean
  onClose: () => void
  onApply: (p: CaptureApplyPayload) => void
  mistakeId?: string
  draftId: string
}) {
  const ai = useAi()
  const toast = useToast()
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<CaptureItem[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [dataUrls, setDataUrls] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState('')
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [ocrBusyKey, setOcrBusyKey] = useState('')
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppingKey, setCroppingKey] = useState('')
  const [cropping, setCropping] = useState(false)
  const [writeText, setWriteText] = useState(true)
  const [targetField, setTargetField] = useState<'content' | 'analysis'>('content')
  const [includeAiFigure, setIncludeAiFigure] = useState(false)

  const autoOcr = ai.can('ocr')
  const estimateCalls = autoOcr ? items.filter((i) => i.ocrStatus === 'running' || i.ocrStatus === 'idle').length : 0
  const active = items.find((i) => i.key === activeKey) || items[0]
  const anyFigure = useMemo(() => items.some((i) => !!i.figureDescription.trim()), [items])

  const patchItem = (key: string, patch: Partial<CaptureItem>) =>
    setItems((prev) => prev.map((i) => i.key === key ? { ...i, ...patch } : i))

  // ---------------- 上传 + 自动 OCR ----------------
  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    if (files.length > MAX_FILES) { toast(`一次最多 ${MAX_FILES} 张整题图，请分批`, 'err'); return }
    const bad = files.map((f) => validateImageFile(f)).find(Boolean)
    if (bad) { toast(bad, 'err'); return }

    setBusy(true)
    setProgress({ done: 0, total: files.length, stage: '准备压缩' })
    try {
      const { ok, failed } = await uploadImagesBatch(
        files,
        { role: 'original', mistakeId, draftId: mistakeId ? undefined : draftId },
        setProgress
      )
      if (failed.length) toast(`${failed.length} 张上传失败：${failed[0].error}（原图未被写入数据库）`, 'err')
      if (!ok.length) return

      const fresh: CaptureItem[] = ok.map(({ image }) => ({
        key: uuid(), image, text: '', options: '', formulas: '', figureDescription: '',
        ocrStatus: 'idle', ocrError: '', ocrSource: '', retryCount: 0, cropped: []
      }))
      setPreviews((p) => {
        const n = { ...p }
        ok.forEach((o, idx) => { n[fresh[idx].key] = o.preview || o.image.signedUrl })
        return n
      })
      setDataUrls((p) => {
        const n = { ...p }
        ok.forEach((o, idx) => { n[fresh[idx].key] = o.dataUrl || o.image.signedUrl })
        return n
      })
      setItems((prev) => [...prev, ...fresh])
      setActiveKey(fresh[0].key)
      toast(`${ok.length} 张整题原图已上传到云端（image_role=original）`, 'ok')

      // ★ 自动 OCR：四个条件必须同时满足。任一不满足 → 不调用，只保留原图
      if (autoOcr) {
        for (const it of fresh) await runAiOcr(it, false)
      } else {
        setItems((prev) => prev.map((i) => fresh.some((f) => f.key === i.key)
          ? { ...i, ocrStatus: 'skipped' } : i))
        toast(`OCR 不可用（${ai.reason('ocr')}）：原图已保留，可点「本地 OCR」或手动录入`, 'err')
      }
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  const runAiOcr = async (it: CaptureItem, isRetry: boolean) => {
    if (!ai.can('ocr')) { toast(`AI 不可用：${ai.reason('ocr')}`, 'err'); return }
    if (isRetry && it.retryCount >= MAX_OCR_RETRY) { toast('已达到重试上限（1 次），请稍后再试或使用本地 OCR', 'err'); return }
    setOcrBusyKey(it.key)
    patchItem(it.key, { ocrStatus: 'running', ocrError: '', retryCount: it.retryCount + (isRetry ? 1 : 0) })
    try {
      const r = await fetch('/api/ai/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: it.image.storage_path, mistakeId, imageId: it.image.id })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'OCR 失败')
      const f = j.full || {}
      patchItem(it.key, {
        text: String(f.text || j.result?.text || ''),
        options: String(f.options || ''),
        formulas: String(f.formulas || (j.result?.formulas || []).join(' ')),
        figureDescription: String(f.figureDescription || ''),
        ocrStatus: 'succeeded', ocrSource: 'ai', ocrError: ''
      })
      toast(j.cached ? '命中 OCR 缓存，未产生新调用' : '识别完成，请先核对预览再确认应用', 'ok')
    } catch (e: any) {
      patchItem(it.key, { ocrStatus: 'failed', ocrError: e?.message || 'OCR 失败' })
      toast(`OCR 失败：${e?.message || '原图已保留，可重试或手动录入'}`, 'err')
    } finally { setOcrBusyKey('') }
  }

  const runLocal = async (it: CaptureItem) => {
    setOcrBusyKey(it.key)
    try {
      const r = await runLocalOcr(dataUrls[it.key] || previews[it.key], {})
      patchItem(it.key, {
        text: r.text, formulas: r.formulas.join(' '), options: '', figureDescription: '',
        ocrStatus: 'succeeded', ocrSource: 'local', ocrError: ''
      })
      toast('本地 OCR 完成（零外部 AI 调用、零费用），请核对后确认应用', 'ok')
    } catch (e: any) {
      toast(`本地 OCR 失败：${e?.message || '原图已保留，可手动录入'}`, 'err')
    } finally { setOcrBusyKey('') }
  }

  // ---------------- 手动裁剪 ----------------
  const confirmCrop = async (rect: CropRectPx, display: string) => {
    if (!active) return
    setCropping(true)
    try {
      const file = await cropFromDataUrl(display, rect)
      const { image, preview } = await uploadImage(file, {
        role: 'cropped', mistakeId, draftId: mistakeId ? undefined : draftId,
        parentImageId: active.image.id, cropRect: rect
      })
      setItems((prev) => prev.map((i) => i.key === active.key ? { ...i, cropped: [...i.cropped, image] } : i))
      setPreviews((p) => ({ ...p, [image.id]: preview || image.signedUrl }))
      toast('裁剪图已上传（image_role=cropped），原整图未改动', 'ok')
      setCroppingKey('')
    } catch (e: any) {
      toast(`裁剪失败：${e?.message || '原图与已保存文字均不受影响'}`, 'err')
    } finally { setCropping(false) }
  }

  // ---------------- 确认应用 ----------------
  const apply = () => {
    if (!items.length) { toast('请先上传一张整题图', 'err'); return }
    const html = items.map((it) => {
      const parts: string[] = []
      if (it.text.trim()) parts.push(`<p>${esc(it.text.trim()).replace(/\n/g, '<br/>')}</p>`)
      if (it.options.trim()) parts.push(`<p>${esc(it.options.trim()).replace(/\n/g, '<br/>')}</p>`)
      if (it.formulas.trim()) parts.push(`<p>公式：${esc(it.formulas.trim())}</p>`)
      // AI 图形描述默认不写入、更不打印；用户手动勾选才加，并强制标注
      if (includeAiFigure && it.figureDescription.trim()) {
        parts.push(`<p><em>（AI 描述，仅供参考：${esc(it.figureDescription.trim())}；请以整题原图为准）</em></p>`)
      }
      return parts.join('')
    }).filter(Boolean).join('<hr/>')

    const images: UploadedImage[] = items.flatMap((i) => [i.image, ...i.cropped])
    onApply({ html: writeText ? html : '', targetField, items, images })
    toast(`${images.length} 张图片已关联（含整题原图），文字${writeText ? '已填入编辑区' : '未写入'}，请核对后点保存`, 'ok')
    onClose()
    setItems([]); setPreviews({}); setDataUrls({}); setActiveKey(''); setZoom(1); setRotation(0)
  }

  const abandonOcr = (it: CaptureItem) => {
    patchItem(it.key, { text: '', options: '', formulas: '', figureDescription: '', ocrStatus: 'skipped', ocrSource: '' })
    toast('已放弃本次 OCR，整题原图仍保留，可直接手动录入', 'ok')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-2 sm:p-6 no-print">
      <div className="my-2 w-full max-w-6xl rounded-2xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800"><FileImage size={19} className="text-brand-600" /> 整题录入预览</h2>
            <p className="muted">左：可编辑的 OCR 文字 ｜ 右：整题原图。确认后文字才写入题干，原图永远保留。</p>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={17} /> 关闭</button>
        </div>

        <div className="space-y-3 p-4">
          {/* 上传入口 + 状态 */}
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera size={16} /> 拍照上传整题</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => albumRef.current?.click()}><Images size={16} /> 相册 / 截图（可多张）</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={(e) => { if (e.target.files) void handleFiles(Array.from(e.target.files)); e.target.value = '' }} />
            <input ref={albumRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { if (e.target.files) void handleFiles(Array.from(e.target.files)); e.target.value = '' }} />
            {busy && <Loader2 size={16} className="animate-spin text-brand-600" />}
            <span className="muted">前端先压缩（最长边 1600 / WebP / 质量 0.8，目标 200–500KB）再上传私有 Storage</span>
          </div>

          {progress && (
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              上传进度：{progress.stage}（{progress.done}/{progress.total}）
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-brand-100">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress.total ? progress.done / progress.total * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {/* AI 开关状态 + 预计调用次数 */}
          <div className={`rounded-lg border px-3 py-2 text-sm ${autoOcr ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {autoOcr ? (
              <><Info size={14} className="mr-1 inline" />AI OCR 已开启：本批<b> 预计调用 {estimateCalls} 次</b>（每张整题图 1 次；同一张图命中缓存不再调用；失败最多重试 1 次）。</>
            ) : (
              <><AlertTriangle size={14} className="mr-1 inline" /><b>OCR 不可用（{ai.reason('ocr')}）</b>：预计 AI 调用 <b>0 次</b>，不产生任何费用。整题原图仍会上传并保留，请手动录入或点「本地 OCR」（浏览器端识别，不联网、不调用 AI）。</>
            )}
          </div>

          {/* 图片标签页 */}
          {items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {items.map((it, idx) => (
                <button key={it.key} type="button" onClick={() => { setActiveKey(it.key); setZoom(1); setRotation(0) }}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${active?.key === it.key ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                  整题 {idx + 1} · {it.ocrStatus === 'succeeded' ? (it.ocrSource === 'local' ? '本地OCR' : 'AI OCR') : it.ocrStatus === 'failed' ? 'OCR失败' : it.ocrStatus === 'running' ? '识别中' : '仅原图'}
                </button>
              ))}
            </div>
          )}

          {/* 预览工作区：左文字 / 右原图 */}
          {active ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="card space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="section-title">① 可编辑文字（OCR 结果，确认后才写入）</h3>
                  <span className="badge bg-slate-100 text-slate-500">{active.ocrSource === 'local' ? '本地 OCR' : active.ocrSource === 'ai' ? 'Coding Plan OCR' : '未识别'}</span>
                </div>
                <textarea value={active.text} onChange={(e) => patchItem(active.key, { text: e.target.value })}
                  placeholder="OCR 识别出的题干文字会显示在这里，可直接修改；AI 关闭时也可以直接在这里手动输入。"
                  className="min-h-[200px] w-full rounded-lg border border-slate-300 p-2 text-sm" />
                <input value={active.options} onChange={(e) => patchItem(active.key, { options: e.target.value })}
                  placeholder="选项文字（可留空）" className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
                <input value={active.formulas} onChange={(e) => patchItem(active.key, { formulas: e.target.value })}
                  placeholder="公式文本（可留空；本地 OCR 无法生成 LaTeX）" className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
                {anyFigure && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    <b>AI 描述，仅供参考</b>：{active.figureDescription || '（本张无图形描述）'}
                    <div className="mt-1">此描述不能替代原图；<b>打印默认不打印</b>，只有在下方手动勾选后才会写入解析。</div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {autoOcr && (
                    <button type="button" className="btn-ghost" disabled={!!ocrBusyKey}
                      onClick={() => void runAiOcr(active, active.retryCount >= 1)}>
                      <RefreshCw size={14} /> {active.retryCount >= 1 ? '已达重试上限' : '重试 AI OCR'}
                    </button>
                  )}
                  <button type="button" className="btn-ghost" disabled={!!ocrBusyKey} onClick={() => void runLocal(active)}>
                    <ScanLine size={14} /> 本地 OCR
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => abandonOcr(active)}><X size={14} /> 放弃 OCR，只留原图</button>
                  {ocrBusyKey === active.key && <Loader2 size={16} className="animate-spin text-brand-600" />}
                </div>
                {active.ocrError && <div className="rounded bg-rose-50 p-2 text-xs text-rose-700">{active.ocrError}（原图已保留，不重复上传）</div>}
              </div>

              <div className="card space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <h3 className="section-title">② 整题原图（云端 Storage）</h3>
                  <div className="flex gap-1">
                    <button type="button" className="rounded border border-slate-200 p-1.5" title="缩小" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><ZoomOut size={14} /></button>
                    <span className="px-1 text-xs text-slate-500">{Math.round(zoom * 100)}%</span>
                    <button type="button" className="rounded border border-slate-200 p-1.5" title="放大" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><ZoomIn size={14} /></button>
                    <button type="button" className="rounded border border-slate-200 p-1.5" title="旋转 90°" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw size={14} /></button>
                  </div>
                </div>
                <div className="max-h-[46vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previews[active.key] || active.image.signedUrl} alt="整题原图" loading="lazy"
                    onError={(e) => { e.currentTarget.alt = '图片加载失败，请检查网络或存储配置' }}
                    style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'top left', transition: 'transform .15s' }}
                    className="block max-w-none" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setCroppingKey(croppingKey === active.key ? '' : active.key)}>
                    <Crop size={14} /> {croppingKey === active.key ? '收起裁剪' : '手动裁剪一块区域'}
                  </button>
                  <a className="btn-ghost" href={previews[active.key] || active.image.signedUrl} download={`整题原图-${active.key.slice(0, 6)}.webp`}>下载这张原图</a>
                  {active.cropped.length > 0 && <span className="badge bg-emerald-50 text-emerald-700">已裁剪 {active.cropped.length} 张</span>}
                </div>
                {croppingKey === active.key && (
                  <ImageCropper src={dataUrls[active.key] || previews[active.key] || active.image.signedUrl}
                    onConfirm={(rect, display) => void confirmCrop(rect, display)}
                    onCancel={() => setCroppingKey('')} />
                )}
                {cropping && <div className="text-xs text-brand-600"><Loader2 size={13} className="mr-1 inline animate-spin" />裁剪图上传中…</div>}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
              还没有整题图。点上方「拍照上传整题」开始；图片会先进云端 Storage，再进入这个预览工作区。
            </div>
          )}

          {/* 确认区 */}
          <div className="card space-y-2 border-brand-200 p-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={writeText} onChange={(e) => setWriteText(e.target.checked)} /> 文字写入</label>
              <label className="flex items-center gap-1"><input type="radio" checked={targetField === 'content'} onChange={() => setTargetField('content')} /> 题干</label>
              <label className="flex items-center gap-1"><input type="radio" checked={targetField === 'analysis'} onChange={() => setTargetField('analysis')} /> 解析</label>
              <label className="flex items-center gap-1.5 text-emerald-700" title="核心原则：整题原图永远保留，不可取消">
                <input type="checkbox" checked disabled /> 整图作为附件保留（锁定）
              </label>
              {anyFigure && (
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeAiFigure} onChange={(e) => setIncludeAiFigure(e.target.checked)} /> 写入 AI 图形描述（会标注「AI 描述，仅供参考」）</label>
              )}
            </div>
            <p className="muted">按核心原则，整题原图必须保留，因此该选项锁定；删除原图需在详情页单独操作并二次确认。</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" disabled={!items.length || busy} onClick={apply}><Check size={16} /> 确认应用</button>
              <button type="button" className="btn-ghost" onClick={onClose}>取消（已上传的原图仍保留在云端）</button>
              <span className="muted">共 {items.length} 张整题图、{items.reduce((n, i) => n + i.cropped.length, 0)} 张裁剪图</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
