'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shuffle, Printer, Check, X, HelpCircle, Loader2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { useOnline, offlineGuard } from '@/components/OnlineStatus'
import { listMistakes, listSubjects, listBooks, listTags, db } from '@/lib/data'
import { renderMath, fmtDate } from '@/lib/utils'
import { CAUSES, type Mistake, type ReviewResult } from '@/types'

export default function RandomPaperPage() {
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const [subjects, setSubjects] = useState<any[]>([])
  const [books, setBooks] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [form, setForm] = useState({ subject_id: '', book_id: '', tag_id: '', cause: '', difficulty: '', dateFrom: '', dateTo: '', count: 10 })
  const [paper, setPaper] = useState<Mistake[]>([])
  const [showAnswer, setShowAnswer] = useState(false)
  const [results, setResults] = useState<Record<string, ReviewResult>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { void Promise.all([listSubjects(), listBooks(), listTags()]).then(([s, b, t]) => { setSubjects(s); setBooks(b); setTags(t) }) }, [])
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // 手动随机抽题：完全不依赖 AI（关闭 AI 后照样可用）
  const draw = async () => {
    setBusy(true)
    try {
      const r = await listMistakes({
        subject_id: form.subject_id || undefined, book_id: form.book_id || undefined,
        tag_id: form.tag_id || undefined, cause: (form.cause || undefined) as any,
        difficulty: form.difficulty ? Number(form.difficulty) : undefined,
        dateFrom: form.dateFrom || undefined, dateTo: form.dateTo || undefined,
        pageSize: 200, sort: 'errors'
      })
      const shuffled = [...r.rows].sort(() => Math.random() - 0.5).slice(0, Math.max(1, Math.min(50, Number(form.count) || 10)))
      setPaper(shuffled); setResults({}); setShowAnswer(false)
      toast(shuffled.length ? `已抽出 ${shuffled.length} 道题` : '符合条件的错题不足，请先放宽筛选', shuffled.length ? 'ok' : 'err')
    } catch (e: any) { toast('抽题失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const sendPrint = () => {
    if (!paper.length) return toast('请先抽题', 'err')
    sessionStorage.setItem('practice-paper', JSON.stringify(paper.map((m) => m.id)))
    router.push('/print')
  }

  const saveResults = async () => {
    if (!offlineGuard(online, toast)) return
    const entries = Object.entries(results)
    if (!entries.length) return toast('请先给每道题标记结果', 'err')
    const supabase = db()
    const user = (await supabase.auth.getUser()).data.user!
    const paperNo = `P${Date.now()}`
    for (const [id, result] of entries) {
      await supabase.from('practice_logs').insert({ user_id: user.id, mistake_id: id, paper_no: paperNo, result })
      const m = paper.find((x) => x.id === id)!
      await supabase.from('mistakes').update({
        mastery: result === 'mastered' ? 'mastered' : result === 'fuzzy' ? 'fuzzy' : 'unmastered',
        error_count: m.error_count + (result === 'again' ? 1 : 0)
      }).eq('id', id)
    }
    toast(`已记录 ${entries.length} 道题的重练结果，并更新掌握状态与错误次数`, 'ok')
    setResults({})
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-xl font-bold text-slate-800">随机组卷 / 错题重练</h1>
        <p className="muted">按条件手动随机抽题（不依赖 AI，关闭 AI 后功能完全正常）。可打印成学生版或答案版。</p>
      </div>

      <div className="no-print card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Sel label="科目" value={form.subject_id} onChange={(v) => set('subject_id', v)} options={subjects.map((s) => [s.id, s.name])} />
          <Sel label="错题本" value={form.book_id} onChange={(v) => set('book_id', v)} options={books.map((b) => [b.id, b.name])} />
          <Sel label="标签" value={form.tag_id} onChange={(v) => set('tag_id', v)} options={tags.map((t) => [t.id, t.name])} />
          <Sel label="错因" value={form.cause} onChange={(v) => set('cause', v)} options={CAUSES.map((c) => [c, c])} />
          <Sel label="难度" value={form.difficulty} onChange={(v) => set('difficulty', v)} options={[1, 2, 3, 4, 5].map((d) => [String(d), `${d} 星`])} />
          <div><label className="label">起始日期</label><input className="input" type="date" value={form.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} /></div>
          <div><label className="label">结束日期</label><input className="input" type="date" value={form.dateTo} onChange={(e) => set('dateTo', e.target.value)} /></div>
          <div><label className="label">题量（1-50）</label><input className="input" type="number" min={1} max={50} value={form.count} onChange={(e) => set('count', e.target.value)} /></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={draw} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />} 随机抽题</button>
          <button className="btn-ghost" onClick={sendPrint}><Printer size={15} /> 生成练习卷 / 打印 / PDF</button>
          <button className="btn-ghost" onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? '隐藏答案' : '显示答案（答案版）'}</button>
        </div>
      </div>

      {paper.length > 0 && (
        <>
          <div className="no-print card flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="flex-1">本卷共 {paper.length} 题 · 已标记 {Object.keys(results).length} 题</span>
            <button className="btn-primary" onClick={saveResults}><Check size={15} /> 保存重练结果</button>
          </div>
          <div className="space-y-3">
            {paper.map((m, i) => (
              <div key={m.id} className="print-block card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-800">{i + 1}. {m.title}</h3>
                  <span className="badge shrink-0">{m.subject?.name || '未分类'} · ★{m.difficulty}</span>
                </div>
                <div className="tiptap mt-2 text-sm" dangerouslySetInnerHTML={{ __html: renderMath(m.content) }} />
                {!!m.images?.length && <div className="mt-2 flex flex-wrap gap-2">{m.images.map((img) => img.signedUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={img.id} src={img.signedUrl} loading="lazy" alt="题目图片" className="max-h-52 rounded border" />
                ))}</div>}
                {!showAnswer && <div className="mt-3 space-y-2">{[1, 2, 3].map((n) => <div key={n} className="h-4 border-b border-dashed border-slate-200" />)}</div>}
                {showAnswer && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                    <div><b>答案：</b><span dangerouslySetInnerHTML={{ __html: renderMath(m.answer) }} /></div>
                    <div className="mt-1"><b>解析：</b><span dangerouslySetInnerHTML={{ __html: renderMath(m.analysis) }} /></div>
                    <div className="mt-1 text-xs text-slate-500">知识点：{m.knowledge_points.join('、') || '—'} · 错因：{m.cause} · 下次复习 {fmtDate(m.next_review_at)}</div>
                  </div>
                )}
                <div className="no-print mt-3 flex flex-wrap gap-2">
                  <span className="muted self-center">本次结果：</span>
                  <button className={`btn-ghost ${results[m.id] === 'again' ? 'border-rose-400 text-rose-600' : 'text-rose-600'}`} onClick={() => setResults((r) => ({ ...r, [m.id]: 'again' }))}><X size={14} /> 又错</button>
                  <button className={`btn-ghost ${results[m.id] === 'fuzzy' ? 'border-amber-400 text-amber-600' : 'text-amber-600'}`} onClick={() => setResults((r) => ({ ...r, [m.id]: 'fuzzy' }))}><HelpCircle size={14} /> 模糊</button>
                  <button className={`btn-ghost ${results[m.id] === 'mastered' ? 'border-emerald-400 text-emerald-600' : 'text-emerald-600'}`} onClick={() => setResults((r) => ({ ...r, [m.id]: 'mastered' }))}><Check size={14} /> 已掌握</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div><label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">全部</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
