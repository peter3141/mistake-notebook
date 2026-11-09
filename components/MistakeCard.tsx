'use client'

import Link from 'next/link'
import { Printer, Trash2, ImageIcon } from 'lucide-react'
import { CAUSES, MASTERY_LABEL, type Mastery, type Mistake } from '@/types'
import { fmtDate, renderMath } from '@/lib/utils'

export function MistakeCard({ m, selected, onSelect, onDelete }: {
  m: Mistake; selected?: boolean; onSelect?: (id: string) => void; onDelete?: (id: string) => void
}) {
  return (
    <div className={`card relative p-3.5 transition ${selected ? 'border-brand-400 ring-2 ring-brand-100' : ''}`}>
      <div className="flex items-start gap-3">
        {onSelect && (
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={selected} onChange={() => onSelect(m.id)} aria-label="选择这道错题" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/mistakes/${m.id}`} className="truncate font-medium text-slate-800 hover:text-brand-600">{m.title || '（无标题）'}</Link>
            <span className="badge">{m.subject?.name || '未分类'}</span>
            <span className={`badge ${m.mastery === 'mastered' ? 'bg-emerald-50 text-emerald-700' : m.mastery === 'fuzzy' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
              {MASTERY_LABEL[m.mastery as Mastery]}
            </span>
          </div>
          {m.content && <div className="prose-mistake mt-1.5 line-clamp-2 text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: renderMath(m.content) }} />}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="badge">{fmtDate(m.mistake_date)}</span>
            <span className="badge">{m.cause}</span>
            <span className="badge">{'★'.repeat(m.difficulty)}</span>
            {m.knowledge_points?.slice(0, 3).map((k) => <span key={k} className="badge bg-brand-50 text-brand-700">{k}</span>)}
            {m.tags?.map((t) => <span key={t.id} className="badge bg-violet-50 text-violet-700">#{t.name}</span>)}
            {m.images?.length ? <span className="badge flex items-center gap-1"><ImageIcon size={11} /> {m.images.length} 图</span> : null}
            {m.images?.some((i) => i.image_role === 'original') && <span className="badge bg-emerald-50 text-emerald-700">整题原图</span>}
          </div>
          {!!m.images?.length && (
            // v4：列表优先用前端 canvas 生成的缩略图，避免把整题大图拉到列表；懒加载
            <div className="mt-2 flex gap-2 overflow-hidden">
              {m.images.filter((i) => i.image_role !== 'thumbnail').slice(0, 4).map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.thumbnailUrl || img.signedUrl} alt="题目缩略图" loading="lazy"
                  className="h-14 w-14 rounded object-cover" />
              ))}
            </div>
          )}
        </div>
        <div className="no-print flex shrink-0 flex-col gap-1">
          <Link href={`/print?ids=${m.id}`} title="单题打印" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"><Printer size={15} /></Link>
          {onDelete && <button title="删除（进回收站）" onClick={() => onDelete(m.id)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>}
        </div>
      </div>
    </div>
  )
}
