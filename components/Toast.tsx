'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

type ToastItem = { id: number; type: 'ok' | 'err' | 'info'; text: string }
const Ctx = createContext<{ toast: (text: string, type?: ToastItem['type']) => void }>({ toast: () => {} })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const toast = useCallback((text: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((p) => [...p, { id, type, text }])
    setTimeout(() => setItems((p) => p.filter((i) => i.id !== id)), 4200)
  }, [])
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-layer pointer-events-none fixed bottom-24 right-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2 md:bottom-6">
        {items.map((i) => (
          <div key={i.id} className={`pointer-events-auto flex items-start gap-2 rounded-xl border bg-white px-3.5 py-3 shadow-lg ${i.type === 'err' ? 'border-rose-200' : i.type === 'ok' ? 'border-emerald-200' : 'border-slate-200'}`}>
            {i.type === 'ok' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> :
             i.type === 'err' ? <AlertCircle size={17} className="mt-0.5 shrink-0 text-rose-600" /> :
             <Info size={17} className="mt-0.5 shrink-0 text-brand-600" />}
            <span className="flex-1 text-sm text-slate-700">{i.text}</span>
            <button className="text-slate-400 hover:text-slate-700" onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))}><X size={15} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
export const useToast = () => useContext(Ctx).toast
