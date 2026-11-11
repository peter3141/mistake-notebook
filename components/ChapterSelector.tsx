'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { listChapterRows, buildChapterTree } from '@/lib/textbooks'
import type { TextbookChapter } from '@/types'

/** 按课本组卷的章节选择器：可多选、可选到章或节、支持搜索章节标题、移动端触控友好 */
export function ChapterSelector({ textbookId, value, onChange }: {
  textbookId: string
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const [tree, setTree] = useState<TextbookChapter[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!textbookId) { setTree([]); return }
    setLoading(true)
    void listChapterRows(textbookId)
      .then((rows) => {
        setTree(buildChapterTree(rows))
        setOpen(Object.fromEntries(rows.filter((r) => r.level === 1).map((r) => [r.id, true])))
      })
      .catch(() => setTree([]))
      .finally(() => setLoading(false))
  }, [textbookId])

  const kw = q.trim().toLowerCase()
  const filtered = useMemo(() => tree.map((ch) => {
    const selfHit = !kw || `${ch.chapter_no} ${ch.title}`.toLowerCase().includes(kw)
    const kids = (ch.children || []).filter((s) => !kw || `${s.chapter_no} ${s.title}`.toLowerCase().includes(kw))
    if (!selfHit && !kids.length) return null
    return { ...ch, children: selfHit && !kw ? (ch.children || []) : kids }
  }).filter(Boolean) as TextbookChapter[], [tree, kw])

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  const toggleChapterWithKids = (ch: TextbookChapter) => {
    const ids = [ch.id, ...(ch.children || []).map((s) => s.id)]
    const all = ids.every((id) => value.includes(id))
    onChange(all ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])])
  }

  if (!textbookId) return <div className="rounded-lg border border-dashed p-4 text-sm text-slate-400">请先选择课本</div>
  if (loading) return <div className="rounded-lg border border-dashed p-4 text-sm text-slate-400">正在加载章节…</div>
  if (!tree.length) return <div className="rounded-lg border border-dashed p-4 text-sm text-slate-400">这本课本还没有章节，请先到「课本」页添加章节</div>

  const allIds = tree.flatMap((ch) => [ch.id, ...(ch.children || []).map((s) => s.id)])

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input className="input pl-8 text-sm" placeholder="搜索章节标题 / 编号（移动端也可用）"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => onChange(allIds)}>全选</button>
        <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => onChange([])}>清空</button>
        <span className="text-xs text-slate-500">已选 {value.length} 个</span>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {filtered.length === 0 && <div className="p-3 text-center text-xs text-slate-400">没有匹配的章节</div>}
        {filtered.map((ch) => {
          const ids = [ch.id, ...(ch.children || []).map((s) => s.id)]
          const all = ids.every((id) => value.includes(id))
          const expanded = kw ? true : (open[ch.id] ?? true)
          return (
            <div key={ch.id} className="mb-1">
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                <button type="button" className="text-slate-400" aria-label="展开/收起"
                  onClick={() => setOpen((o) => ({ ...o, [ch.id]: !expanded }))}>
                  {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <button type="button" onClick={() => toggleChapterWithKids(ch)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${all ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}
                  aria-label="选择本章">
                  {all && <Check size={13} />}
                </button>
                <button type="button" className="flex-1 text-left text-sm font-medium text-slate-700" onClick={() => toggle(ch.id)}>
                  <span className="mr-1 text-slate-400">{ch.chapter_no}</span>{ch.title}
                  <span className="ml-2 text-xs font-normal text-slate-400">章 · 含 {(ch.children || []).length} 节</span>
                </button>
                {value.includes(ch.id) && <span className="badge">已选章</span>}
              </div>
              {expanded && (ch.children || []).length > 0 && (
                <div className="ml-9 space-y-0.5 border-l border-slate-100 pl-2">
                  {(ch.children || []).map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                      <input type="checkbox" className="accent-brand-600" checked={value.includes(s.id)} onChange={() => toggle(s.id)} />
                      <span className="text-slate-400">{s.chapter_no}</span>{s.title}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
        只选「章」会自动包含其下所有节；也可以只勾选某几个节。抽题范围仅为用户维护的章节映射与真实错题。
      </p>
    </div>
  )
}
