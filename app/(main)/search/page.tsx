'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, BookOpen, CalendarDays, ListTodo, StickyNote, Tag, Loader2 } from 'lucide-react'
import { searchAll } from '@/lib/data-v2'
import { useToast } from '@/components/Toast'
import { SEARCH_MODULE_LABEL, type SearchHit, type SearchModule } from '@/types'

const ICONS: Record<SearchModule, React.ElementType> = {
  mistake: BookOpen, schedule: CalendarDays, task: ListTodo, note: StickyNote, tag: Tag
}
const MODULES: SearchModule[] = ['mistake', 'schedule', 'task', 'note', 'tag']

export default function SearchPage() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<SearchModule | 'all'>('all')

  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const t = setTimeout(() => {
      setLoading(true)
      void searchAll(q).then(setHits).catch((e: any) => toast('搜索失败：' + e.message, 'err')).finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const grouped = MODULES.map((m) => ({ module: m, items: hits.filter((h) => h.module === m) }))
    .filter((g) => active === 'all' || g.module === active)
  const total = active === 'all' ? hits.length : grouped.reduce((a, g) => a + g.items.length, 0)

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">统一搜索</h1>
        <p className="muted">一次输入，跨错题、日程、待办、笔记、标签搜索，结果按模块分组（不依赖 AI）</p></div>

      <div className="card flex items-center gap-2 p-2">
        <Search size={18} className="ml-1 text-slate-400" />
        <input className="input border-0 py-2 text-base focus:ring-0" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="搜索题目、答案、解析、日程标题、任务、笔记、标签…" />
        {loading && <Loader2 size={17} className="mr-2 animate-spin text-brand-600" />}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setActive('all')} className={`chip ${active === 'all' ? 'border-brand-400 bg-brand-50 text-brand-700' : ''}`}>全部（{hits.length}）</button>
        {MODULES.map((m) => (
          <button key={m} onClick={() => setActive(m)} className={`chip ${active === m ? 'border-brand-400 bg-brand-50 text-brand-700' : ''}`}>
            {SEARCH_MODULE_LABEL[m]}（{hits.filter((h) => h.module === m).length}）
          </button>
        ))}
      </div>

      {!q.trim() ? (
        <div className="card p-10 text-center muted">输入关键词开始搜索。例如「函数」「复习」「物理」。</div>
      ) : total === 0 && !loading ? (
        <div className="card p-10 text-center muted">没有找到「{q}」相关内容。换个词试试，或先去对应模块新建一条。</div>
      ) : (
        <div className="space-y-4">
          {grouped.filter((g) => g.items.length > 0).map((g) => {
            const Icon = ICONS[g.module]
            return (
              <div key={g.module} className="card p-4">
                <h2 className="section-title flex items-center gap-2"><Icon size={16} className="text-brand-600" /> {SEARCH_MODULE_LABEL[g.module]}（{g.items.length}）</h2>
                <ul className="mt-3 divide-y">
                  {g.items.map((h) => (
                    <li key={h.module + h.id} className="py-2.5">
                      <Link href={h.href} className="block text-sm font-medium text-slate-700 hover:text-brand-600">{h.title}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        {h.excerpt && <span className="line-clamp-1 flex-1">{h.excerpt}</span>}
                        {h.extra && <span className="badge">{h.extra}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
