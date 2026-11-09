'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/** 所有敏感操作统一二次确认；requireText 不为空时还需手动输入确认词 */
export function ConfirmDialog({
  open, title, description, confirmText = '确认删除', requireText, danger = true, busy = false,
  onConfirm, onClose
}: {
  open: boolean
  title: string
  description: string
  confirmText?: string
  requireText?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  if (!open) return null
  const blocked = !!requireText && typed.trim() !== requireText
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${danger ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
          </div>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}><X size={18} /></button>
        </div>
        {requireText && (
          <div className="mt-4">
            <label className="label">请输入 <b className="text-rose-600">{requireText}</b> 以确认</label>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireText} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={blocked || busy} onClick={() => void onConfirm()}>
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
