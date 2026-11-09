'use client'

import { Search, RotateCcw } from 'lucide-react'
import { CAUSES, MASTERY_LABEL, type Cause, type Mastery, type MistakeFilters, type MistakeBook, type Subject, type Tag } from '@/types'

export function FilterBar({
  filters, onChange, subjects, books, tags
}: {
  filters: MistakeFilters
  onChange: (f: MistakeFilters) => void
  subjects: Subject[]
  books: MistakeBook[]
  tags: Tag[]
}) {
  const set = (k: keyof MistakeFilters, v: any) => onChange({ ...filters, [k]: v, page: 1 })
  const Sel = ({ k, value, children }: { k: keyof MistakeFilters; value: string; children: React.ReactNode }) => (
    <select className="input h-9 py-1 text-xs" value={value} onChange={(e) => set(k, e.target.value)}>{children}</select>
  )
  return (
    <div className="no-print card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[190px] flex-1">
          <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input className="input h-9 py-1 pl-8 text-sm" placeholder="搜索题目 / 答案 / 解析 / 标签 / 知识点 / 来源"
            value={filters.q || ''} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Sel k="subject_id" value={filters.subject_id || ''}><option value="">全部科目</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Sel>
        <Sel k="book_id" value={filters.book_id || ''}><option value="">全部错题本</option>{books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Sel>
        <Sel k="tag_id" value={filters.tag_id || ''}><option value="">全部标签</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
        <Sel k="cause" value={filters.cause || ''}><option value="">全部错因</option>{CAUSES.map((c) => <option key={c}>{c}</option>)}</Sel>
        <Sel k="difficulty" value={String(filters.difficulty || '')}><option value="">全部难度</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} 星</option>)}</Sel>
        <Sel k="mastery" value={filters.mastery || ''}><option value="">全部掌握状态</option>{Object.entries(MASTERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Sel>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">时间依据</span>
        <Sel k="dateBy" value={filters.dateBy || 'mistake_date'}>
          <option value="mistake_date">错题发生时间</option><option value="created_at">录入时间</option><option value="next_review_at">复习时间</option>
        </Sel>
        <input className="input h-9 w-36 py-1 text-xs" type="date" value={filters.dateFrom || ''} onChange={(e) => set('dateFrom', e.target.value)} />
        <span className="text-xs text-slate-400">至</span>
        <input className="input h-9 w-36 py-1 text-xs" type="date" value={filters.dateTo || ''} onChange={(e) => set('dateTo', e.target.value)} />
        <Sel k="sort" value={filters.sort || 'newest'}>
          <option value="newest">最新优先</option><option value="oldest">最旧优先</option>
          <option value="review">待复习优先</option><option value="errors">错误次数优先</option>
        </Sel>
        <Sel k="group" value={filters.group || 'none'}>
          <option value="none">不分组</option><option value="week">按周分组</option><option value="month">按月分组</option>
          <option value="timeline">时间轴</option><option value="calendar">日历视图</option>
        </Sel>
        <button className="btn-ghost h-9 py-1 text-xs" onClick={() => onChange({ sort: 'newest', group: 'none', page: 1 })}><RotateCcw size={13} /> 重置</button>
      </div>
    </div>
  )
}
