'use client'

import { useRef, useState } from 'react'
import { Camera, Images, UploadCloud, X, ScanText, ScanLine, Loader2 } from 'lucide-react'
import { compressImage, uid } from '@/lib/utils'

export interface LocalImage {
  key: string
  file?: File                 // 待上传
  preview: string             // 本地 objectURL 或签名 URL
  dataUrl?: string            // 供 AI 整理 / OCR 使用（只在内存，绝不入库）
  storagePath?: string        // 已入库图片
  dbId?: string
  /** v4：original=整题原图 / cropped=手动裁剪图 / inline=普通插图 */
  role?: 'original' | 'cropped' | 'inline' | 'thumbnail'
  parentImageId?: string
  /** 已在云端（上传成功）的图不再重复上传 */
  uploaded?: boolean
}

export function ImageUploader({
  value, onChange, onOcr, canOcr = false, ocrBusy = false, onLocalOcr, localOcrBusy = false
}: {
  value: LocalImage[]
  onChange: (v: LocalImage[]) => void
  onOcr?: (dataUrl: string) => void
  canOcr?: boolean
  ocrBusy?: boolean
  /** 本地 OCR：不依赖 AI，AI 总开关关闭时依然可用 */
  onLocalOcr?: (dataUrl: string) => void
  localOcrBusy?: boolean
}) {
  const albumRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 9 - value.length)
    if (!list.length) return
    setBusy(true)
    try {
      const next: LocalImage[] = []
      for (const f of list) {
        const small = await compressImage(f)              // 自动压缩，最长边 1600px / webp
        const preview = URL.createObjectURL(small)
        const dataUrl = await new Promise<string>((res) => {
          const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(small)
        })
        next.push({ key: uid(), file: small, preview, dataUrl })
      }
      onChange([...value, ...next])
    } finally { setBusy(false) }
  }

  const remove = (key: string) => {
    const item = value.find((v) => v.key === key)
    if (item?.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview)
    onChange(value.filter((v) => v.key !== key))
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files) }}
        onPaste={(e) => { const fs = e.clipboardData?.files; if (fs?.length) { e.preventDefault(); void addFiles(fs) } }}
        className={`no-print rounded-xl border-2 border-dashed p-4 transition ${dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50'}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => cameraRef.current?.click()}><Camera size={16} /> 拍照</button>
          <button type="button" className="btn-ghost" onClick={() => albumRef.current?.click()}><Images size={16} /> 相册 / 选文件</button>
          <span className="muted flex items-center gap-1"><UploadCloud size={14} /> 也可拖拽或 Ctrl+V 粘贴图片（自动压缩）</span>
          {(busy || ocrBusy || localOcrBusy) && <Loader2 size={16} className="animate-spin text-brand-600" />}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
        <input ref={albumRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
      </div>

      {value.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {value.map((img) => (
            <div key={img.key} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              {/* 图片懒加载 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.preview} alt="错题图片" loading="lazy" className="h-28 w-full object-cover" />
              <div className="no-print absolute right-1 top-1 flex gap-1">
                {canOcr && onOcr && img.dataUrl && (
                  <button type="button" title="AI OCR：调用 Coding Plan 视觉模型（需开启 AI，会产生调用）" onClick={() => onOcr(img.dataUrl!)}
                    className="rounded-md bg-white/95 p-1.5 text-brand-600 shadow hover:bg-brand-50"><ScanText size={14} /></button>
                )}
                {onLocalOcr && img.dataUrl && (
                  <button type="button" title="本地 OCR：浏览器离线识别，中英文，免费，不调用任何 AI 接口" onClick={() => onLocalOcr(img.dataUrl!)}
                    className="rounded-md bg-white/95 p-1.5 text-emerald-600 shadow hover:bg-emerald-50"><ScanLine size={14} /></button>
                )}
                <button type="button" title="移除" onClick={() => remove(img.key)}
                  className="rounded-md bg-white/95 p-1.5 text-rose-600 shadow hover:bg-rose-50"><X size={14} /></button>
              </div>
              {img.storagePath && <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] text-white">已上传</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
