'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, X, BookOpen, CalendarDays, ListTodo, StickyNote, Camera, Repeat2, Settings2 } from 'lucide-react'

const ITEMS = [
  { href: '/mistakes/new', label: '新建错题', icon: BookOpen, color: 'bg-brand-50 text-brand-600' },
  { href: '/mistakes/new?camera=1', label: '拍照录题', icon: Camera, color: 'bg-rose-50 text-rose-600' },
  { href: '/calendar?new=1', label: '新建日程', icon: CalendarDays, color: 'bg-sky-50 text-sky-600' },
  { href: '/tasks?new=1', label: '新建待办', icon: ListTodo, color: 'bg-amber-50 text-amber-600' },
  { href: '/notes?new=1', label: '新建笔记', icon: StickyNote, color: 'bg-emerald-50 text-emerald-600' },
  { href: '/review', label: '今日待复习', icon: Repeat2, color: 'bg-violet-50 text-violet-600' },
  { href: '/settings', label: '设置', icon: Settings2, color: 'bg-slate-100 text-slate-600' }
]

/** 移动端底部操作栏的「快速新建」弹出菜单（第 7 段第四节） */
export function QuickCreateMenu() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="快速新建"
        className="flex flex-col items-center justify-center gap-0.5 py-2 text-brand-600">
        <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-200">
          <Plus size={23} />
        </span>
        <span className="text-[11px] font-medium">快速新建</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/40" />
          <div className="relative w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">快速新建</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {ITEMS.map((it) => (
                <Link key={it.href + it.label} href={it.href} onClick={() => setOpen(false)}
                  className="flex flex-col items-center gap-1.5 rounded-xl py-2 text-center transition hover:bg-slate-50">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${it.color}`}><it.icon size={20} /></span>
                  <span className="text-[11px] leading-tight text-slate-600">{it.label}</span>
                </Link>
              ))}
            </div>
            <p className="mt-4 text-center text-[11px] text-slate-400">关闭 AI 后，以上入口全部照常可用</p>
          </div>
        </div>
      )}
    </>
  )
}
