'use client'

import { useRef, useState } from 'react'
import { Check, X, Crop } from 'lucide-react'

/** 归一化矩形（0–1 比例），与显示尺寸无关 */
interface NRect { x: number; y: number; w: number; h: number }
export interface CropRectPx { x: number; y: number; w: number; h: number }

/**
 * 手动裁剪：用户在整题原图上「拖框选区」。
 * ★ 只做用户手动框选，不实现「AI 自动从整张试卷里切出几何图」——视觉模型做不到精确图像分割。
 */
export function ImageCropper({
  src, onConfirm, onCancel
}: {
  src: string
  onConfirm: (rect: CropRectPx, display: string) => void
  onCancel: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<NRect | null>(null)

  const point = (e: React.PointerEvent) => {
    const b = boxRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))
    }
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const p = point(e)
    start.current = p
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const move = (e: React.PointerEvent) => {
    if (!start.current) return
    const p = point(e), s = start.current
    setRect({
      x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y)
    })
  }
  const up = () => { start.current = null }

  const confirm = () => {
    const img = imgRef.current
    if (!img || !rect || rect.w < 0.02 || rect.h < 0.02) return
    onConfirm({
      x: Math.round(rect.x * img.naturalWidth),
      y: Math.round(rect.y * img.naturalHeight),
      w: Math.round(rect.w * img.naturalWidth),
      h: Math.round(rect.h * img.naturalHeight)
    }, src)
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-brand-800"><Crop size={15} className="mr-1 inline" />手动裁剪</div>
        <div className="text-xs text-slate-500">在图片上按住鼠标拖动（手机用手指拖动）框出需要的区域</div>
      </div>
      <div
        ref={boxRef}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="relative max-h-[52vh] cursor-crosshair select-none overflow-auto rounded-lg border border-slate-300 bg-white touch-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt="待裁剪的整题原图" className="block max-w-full" draggable={false} />
        {rect && rect.w > 0 && (
          <div className="pointer-events-none absolute border-2 border-brand-500 bg-brand-400/20"
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={!rect || rect.w < 0.02} onClick={confirm}><Check size={15} /> 确认裁剪并上传</button>
        <button type="button" className="btn-ghost" onClick={onCancel}><X size={15} /> 取消（不影响原图）</button>
        <span className="muted">裁剪图会另存一条记录，<b>原整图不会被删除或改动</b>。</span>
      </div>
    </div>
  )
}
