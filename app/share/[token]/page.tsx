'use client'

import { useEffect, useState } from 'react'
import { BookOpen, Lock, Clock, AlertTriangle } from 'lucide-react'
import { renderMath, fmtDateTime } from '@/lib/utils'

interface SharedMistake {
  id: string; title: string; content: string; answer: string; analysis: string
  knowledgePoints: string[]; cause: string; difficulty: number; mistakeDate: string
  subjectName: string; images: string[]
}

export default function SharePage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<{
    title: string; expiresAt: string; count: number; kind?: string
    mistakes: SharedMistake[]
    notes?: { id: string; title: string; content: string; tags: string[]; summary: string }[]
    schedules?: { id: string; title: string; start_at: string; end_at: string | null; all_day: boolean; location: string; category: string; priority: number; description: string }[]
  } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    void fetch(`/api/share/${params.token}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || '无法打开'); setData(j) })
      .catch((e) => setErr(e.message))
  }, [params.token])

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4 font-semibold text-brand-700">
          <BookOpen size={19} /> 个人综合管理 · 只读分享
          <span className="ml-auto flex items-center gap-1 text-xs font-normal text-slate-400"><Lock size={13} /> 只读，无法编辑</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {err && (
          <div className="card flex items-center gap-3 p-6 text-rose-700">
            <AlertTriangle size={20} /> <div><b>无法打开这个分享</b><p className="text-sm">{err}</p></div>
          </div>
        )}
        {data && (
          <>
            <div className="card flex flex-wrap items-center gap-2 p-4">
              <div className="flex-1"><h1 className="text-lg font-bold text-slate-800">{data.title}</h1><p className="muted">共 {data.count} 条内容 · 已隐藏账号信息与隐私字段</p></div>
              <span className="badge flex items-center gap-1"><Clock size={12} /> 有效期至 {fmtDateTime(data.expiresAt)}</span>
            </div>
            {data.mistakes.map((m, i) => (
              <article key={m.id} className="print-block card p-4">
                <h2 className="font-semibold text-slate-800">{i + 1}. {m.title}</h2>
                <div className="mt-1 text-xs text-slate-400">{m.subjectName} · {'★'.repeat(m.difficulty)} · {m.mistakeDate} · 错因：{m.cause}</div>
                {m.content && <div className="tiptap mt-2 text-sm" dangerouslySetInnerHTML={{ __html: renderMath(m.content) }} />}
                {m.images.map((src, n) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={n} src={src} alt="题目图片" loading="lazy" className="mt-2 max-h-72 max-w-full rounded border" />
                ))}
                {m.knowledgePoints?.length > 0 && <div className="mt-2 text-xs text-slate-500">知识点：{m.knowledgePoints.join('、')}</div>}
                {m.answer && <div className="mt-2 text-sm"><b>答案：</b><span dangerouslySetInnerHTML={{ __html: renderMath(m.answer) }} /></div>}
                {m.analysis && <div className="mt-1 text-sm"><b>解析：</b><span dangerouslySetInnerHTML={{ __html: renderMath(m.analysis) }} /></div>}
              </article>
            ))}

            {/* v2：笔记只读分享（隐藏编辑按钮、user_id、关联 id 等隐私字段） */}
            {(data.notes || []).map((n) => (
              <article key={n.id} className="print-block card p-4">
                <h2 className="font-semibold text-slate-800">{n.title}</h2>
                {n.tags?.length > 0 && <div className="mt-1 text-xs text-slate-400">标签：{n.tags.join(' / ')}</div>}
                {n.summary && <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">摘要：{n.summary}</div>}
                {n.content && <div className="tiptap mt-2 text-sm" dangerouslySetInnerHTML={{ __html: renderMath(n.content) }} />}
              </article>
            ))}

            {(data.schedules || []).map((s) => (
              <article key={s.id} className="print-block card p-4">
                <h2 className="font-semibold text-slate-800">{s.title}</h2>
                <div className="mt-1 text-xs text-slate-400">
                  {s.all_day ? '全天' : new Date(s.start_at).toLocaleString('zh-CN')}
                  {s.end_at ? ` ~ ${new Date(s.end_at).toLocaleString('zh-CN')}` : ''} · {s.category}
                  {s.location ? ` · 地点：${s.location}` : ''}
                </div>
                {s.description && <p className="mt-2 text-sm text-slate-600">{s.description}</p>}
              </article>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
