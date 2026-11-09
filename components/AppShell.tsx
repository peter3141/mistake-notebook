'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, CalendarDays, ListTodo, BookOpen, StickyNote, Repeat2,
  Flame, Timer, Target, Search, Printer, BarChart3, Settings, Trash2, LogOut
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useToast } from './Toast'
import { QuickCreateMenu } from './QuickCreateMenu'

/** v2（第 7 段）：整站导航，错题本只是其中一个模块 */
const NAV = [
  { href: '/', label: '首页', icon: LayoutDashboard },
  { href: '/calendar', label: '日程', icon: CalendarDays },
  { href: '/tasks', label: '待办', icon: ListTodo },
  { href: '/mistakes', label: '错题', icon: BookOpen },
  { href: '/notes', label: '笔记', icon: StickyNote },
  { href: '/review', label: '复习', icon: Repeat2 },
  { href: '/habits', label: '习惯', icon: Flame },
  { href: '/focus', label: '专注', icon: Timer },
  { href: '/goals', label: '目标', icon: Target },
  { href: '/search', label: '搜索', icon: Search },
  { href: '/print', label: '打印', icon: Printer },
  { href: '/stats', label: '统计', icon: BarChart3 },
  { href: '/settings', label: '设置', icon: Settings }
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  const toast = useToast()

  const signOut = async () => {
    await createClient().auth.signOut()
    toast('已退出登录', 'ok')
    router.push('/login'); router.refresh()
  }

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-brand-700">
            <LayoutDashboard size={20} /><span className="hidden sm:inline">个人综合管理</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-0.5 overflow-x-auto md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((n) => {
              const active = n.href === '/' ? path === '/' : path.startsWith(n.href)
              return (
                <Link key={n.href} href={n.href} className={cn(
                  'shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] transition',
                  active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                )}>{n.label}</Link>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/search" title="统一搜索" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden"><Search size={17} /></Link>
            <Link href="/trash" title="统一回收站" className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 sm:block"><Trash2 size={17} /></Link>
            <button onClick={signOut} title="退出登录" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut size={17} /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:pb-12">{children}</main>

      {/* 移动端底部操作栏：中间「+」展开快速新建（错题 / 日程 / 待办 / 笔记 / 拍照） */}
      <nav className="mobile-tabbar no-print fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <Tab href="/" icon={LayoutDashboard} label="首页" active={path === '/'} />
        <Tab href="/calendar" icon={CalendarDays} label="日程" active={path.startsWith('/calendar')} />
        <QuickCreateMenu />
        <Tab href="/tasks" icon={ListTodo} label="待办" active={path.startsWith('/tasks')} />
        <Tab href="/mistakes" icon={BookOpen} label="错题" active={path.startsWith('/mistakes')} />
      </nav>
    </div>
  )
}

function Tab({ href, icon: Icon, label, active }: { href: string; icon: React.ElementType; label: string; active: boolean }) {
  return (
    <Link href={href} className={cn('flex flex-col items-center justify-center gap-0.5 py-2 text-[11px]', active ? 'text-brand-600' : 'text-slate-400')}>
      <Icon size={19} /><span>{label}</span>
    </Link>
  )
}
