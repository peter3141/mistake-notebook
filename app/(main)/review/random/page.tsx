'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Shuffle, Printer, Check, X, HelpCircle, Loader2, Sparkles, BookOpen,
  Save, Trash2, AlertTriangle, RefreshCw, Pencil, Layers
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { useOnline, offlineGuard } from '@/components/OnlineStatus'
import { useAi } from '@/components/AiProvider'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ChapterSelector } from '@/components/ChapterSelector'
import { listMistakes, listSubjects, listBooks, listTags, db } from '@/lib/data'
import {
  listTextbooks, listChapterRows, buildChapterTree, flattenChapters, chapterMaterialState,
  drawByChapters, listQuizTemplates, saveQuizTemplate, deleteQuizTemplate,
  requestTextbookQuiz, aiQuestionToMistake, getChapterMaterialText
} from '@/lib/textbooks'
import { renderMath, fmtDate } from '@/lib/utils'
import {
  CAUSES, type Mistake, type ReviewResult, type PaperItem, type AiQuizQuestion,
  type Textbook, type TextbookQuizConfig, type TextbookQuizTemplate
} from '@/types'

const DEFAULT_CFG: TextbookQuizConfig = {
  subject_id: '', textbook_id: '', chapter_ids: [], count: 10,
  difficulty_min: 1, difficulty_max: 5, only_weak: false
}

export default function RandomPaperPage() {
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const ai = useAi()
  const [mode, setMode] = useState<'random' | 'textbook'>('random')

  // ---------- 原有「按条件随机组卷」状态（一行未删，功能保持不变） ----------
  const [subjects, setSubjects] = useState<any[]>([])
  const [books, setBooks] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [form, setForm] = useState({ subject_id: '', book_id: '', tag_id: '', cause: '', difficulty: '', dateFrom: '', dateTo: '', count: 10 })
  const [paper, setPaper] = useState<Mistake[]>([])
  const [showAnswer, setShowAnswer] = useState(false)
  const [results, setResults] = useState<Record<string, ReviewResult>>({})
  const [busy, setBusy] = useState(false)

  // ---------- v5「按科目课本组卷」状态 ----------
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [cfg, setCfg] = useState<TextbookQuizConfig>(DEFAULT_CFG)
  const [chapterOptions, setChapterOptions] = useState<Array<{ id: string; label: string }>>([])
  const [items, setItems] = useState<PaperItem[]>([])
  const [shortfall, setShortfall] = useState(0)
  const [chapterTitles, setChapterTitles] = useState<string[]>([])
  const [materialReady, setMaterialReady] = useState<Record<string, boolean>>({})
  const [aiChapterIds, setAiChapterIds] = useState<string[]>([])
  const [templates, setTemplates] = useState<TextbookQuizTemplate[]>([])
  const [aiCandidates, setAiCandidates] = useState<Array<{ q: AiQuizQuestion; confirmed: boolean }>>([])
  const [aiTarget, setAiTarget] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [aiConfirmOpen, setAiConfirmOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState('')
  const [tbResults, setTbResults] = useState<Record<string, ReviewResult>>({})

  useEffect(() => {
    void Promise.all([listSubjects(), listBooks(), listTags(), listTextbooks(), listQuizTemplates()])
      .then(([s, b, t, tb, tpl]) => {
        setSubjects(s); setBooks(b); setTags(t); setTextbooks(tb); setTemplates(tpl)
      })
      .catch((e) => toast('基础数据加载失败：' + e.message, 'err'))
  }, [])

  useEffect(() => {
    if (!cfg.textbook_id) { setChapterOptions([]); return }
    void listChapterRows(cfg.textbook_id).then((rows) => {
      const flat = flattenChapters(buildChapterTree(rows))
      setChapterOptions(flat.map((c) => ({ id: c.id, label: `${c.chapter_no ? c.chapter_no + ' ' : ''}${c.title}` })))
    }).catch(() => setChapterOptions([]))
  }, [cfg.textbook_id])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const setCfgField = <K extends keyof TextbookQuizConfig>(k: K, v: TextbookQuizConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }))

  // =========================================================================
  // 原有模式：手动随机抽题（完全不依赖 AI，关闭 AI 后照样可用）
  // =========================================================================
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
    if (mode === 'random') {
      if (!paper.length) return toast('请先抽题', 'err')
      sessionStorage.setItem('practice-paper', JSON.stringify(paper.map((m) => m.id)))
      sessionStorage.removeItem('practice-paper-ai')
      sessionStorage.removeItem('practice-paper-variant')
    } else {
      if (!items.length) return toast('请先按课本章节抽题', 'err')
      const realIds = items.filter((i) => i.kind === 'real').map((i) => i.kind === 'real' ? i.mistake.id : '')
      // ★ AI 生成题默认不进打印，只有用户逐题手动勾选「加入学生版打印」才会被带上
      const aiPrint = items
        .filter((i) => i.kind === 'ai' && i.includeInPrint)
        .map((i, idx) => i.kind === 'ai' ? aiQuestionToMistake(i.question, i.chapterTitle, idx) : null)
        .filter(Boolean)
      sessionStorage.setItem('practice-paper', JSON.stringify(realIds))
      sessionStorage.setItem('practice-paper-ai', JSON.stringify(aiPrint))
      // 用户手动勾选了 AI 题进打印 → 默认落到学生版；没勾选则沿用原组卷的答案版
      sessionStorage.setItem('practice-paper-variant', aiPrint.length ? 'student' : 'answer')
    }
    router.push('/print')
  }

  const saveResults = async () => {
    if (!offlineGuard(online, toast)) return
    const entries = Object.entries(mode === 'random' ? results : tbResults)
    if (!entries.length) return toast('请先给每道题标记结果', 'err')
    const supabase = db()
    const user = (await supabase.auth.getUser()).data.user!
    const paperNo = `P${Date.now()}`
    const source = mode === 'random' ? paper : items.filter((i) => i.kind === 'real').map((i) => i.kind === 'real' ? i.mistake : null).filter(Boolean) as Mistake[]
    for (const [id, result] of entries) {
      await supabase.from('practice_logs').insert({ user_id: user.id, mistake_id: id, paper_no: paperNo, result })
      const m = source.find((x) => x.id === id)!
      if (!m) continue
      await supabase.from('mistakes').update({
        mastery: result === 'mastered' ? 'mastered' : result === 'fuzzy' ? 'fuzzy' : 'unmastered',
        error_count: m.error_count + (result === 'again' ? 1 : 0)
      }).eq('id', id)
    }
    toast(`已记录 ${entries.length} 道题的重练结果，并更新掌握状态与错误次数`, 'ok')
    mode === 'random' ? setResults({}) : setTbResults({})
  }

  // =========================================================================
  // v5：按科目 → 课本 → 章节抽真实错题（三级优先级）
  // =========================================================================
  const drawTextbook = async () => {
    if (!cfg.textbook_id) return toast('请先选择课本', 'err')
    if (!cfg.chapter_ids.length) return toast('请至少选择一个章节', 'err')
    setBusy(true)
    try {
      const r = await drawByChapters(cfg)
      setItems(r.items); setShortfall(r.shortfall); setChapterTitles(r.chapterTitles)
      setTbResults({}); setShowAnswer(false); setAiCandidates([])
      // 前端也检查材料：选了「章」时把其下所有节一起算进去（材料常挂在节上）
      const chapterRows = await listChapterRows(cfg.textbook_id)
      const flatCh = flattenChapters(buildChapterTree(chapterRows))
      const expanded = new Set(cfg.chapter_ids)
      for (const id of cfg.chapter_ids) {
        const ch = flatCh.find((c) => c.id === id)
        if (ch?.level === 1) flatCh.forEach((c) => { if (c.parent_id === id) expanded.add(c.id) })
      }
      const ids = [...expanded].slice(0, 30)
      const pairs = await Promise.all(ids.map(async (id) => [id, (await chapterMaterialState(id)).ready] as const))
      const readyMap = Object.fromEntries(pairs)
      setMaterialReady(readyMap)
      setAiChapterIds(ids)
      setAiTarget(ids.find((id) => readyMap[id]) || '')
      toast(r.items.length
        ? `已抽出 ${r.items.length} 道真实错题（直接关联 ${r.directCount} / 知识点命中 ${r.indirectCount}）`
        : '所选章节下没有可用错题', r.items.length ? 'ok' : 'err')
    } catch (e: any) { toast('按章节抽题失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const aiAvailable = ai.can('textbook_quiz')
  const aiReason = ai.reason('textbook_quiz')
  const targetReady = !!aiTarget && !!materialReady[aiTarget]
  const aiButtonEnabled = shortfall > 0 && aiAvailable && targetReady && !aiLoading

  const buildQuizPayload = async (count: number, regenerateOf?: string) => {
    const book = textbooks.find((b) => b.id === cfg.textbook_id)
    const chapter = chapterOptions.find((c) => c.id === aiTarget)
    const materialText = aiTarget ? await getChapterMaterialText(aiTarget) : ''
    return {
      subject: subjects.find((s) => s.id === cfg.subject_id)?.name || '',
      textbook: book?.name || '',
      chapterTitle: chapter?.label || '',
      chapterId: aiTarget,
      materialText,                 // ★ 请求体包含摘要 / OCR 片段；服务端以 DB 材料为准复核
      count,
      difficultyMin: cfg.difficulty_min,
      difficultyMax: cfg.difficulty_max,
      questionType: '课本同步练习',
      regenerateOf
    }
  }

  const callAi = async () => {
    setAiLoading('生成中')
    try {
      const res = await requestTextbookQuiz(await buildQuizPayload(Math.min(10, Math.max(1, shortfall))))
      if (res.insufficient) {
        toast(`材料不足，未生成任何题目：${res.reason || '请补充课本材料或章节摘要'}`, 'err')
        setAiCandidates([])
        return
      }
      const qs = (res.questions || []).slice(0, 10)
      if (!qs.length) { toast('AI 未返回可用题目，请检查课本材料是否充分', 'err'); return }
      setAiCandidates(qs.map((q) => ({ q, confirmed: false })))
      toast(`已生成 ${qs.length} 道候选题：请逐题确认后才会加入组卷结果`, 'ok')
    } catch (e: any) {
      toast(`AI 补充出题失败：${e.message}`, 'err')
    } finally { setAiLoading('') }
  }

  const regenerateOne = async (idx: number) => {
    const old = aiCandidates[idx]
    if (!old) return
    setAiLoading(`regen-${idx}`)
    try {
      const res = await requestTextbookQuiz(await buildQuizPayload(1, old.q.stem))
      if (res.insufficient || !res.questions?.length) {
        toast(`重新生成失败：${res.reason || '材料不足，未编造题目'}`, 'err')
        return
      }
      setAiCandidates((list) => list.map((c, i) => i === idx ? { q: res.questions![0], confirmed: false } : c))
      toast('该题已重新生成（仍需确认）', 'ok')
    } catch (e: any) { toast(`重新生成失败：${e.message}`, 'err') }
    finally { setAiLoading('') }
  }

  const confirmAiCandidates = () => {
    const picked = aiCandidates.filter((c) => c.confirmed)
    if (!picked.length) return toast('请先逐题勾选确认', 'err')
    const chapter = chapterOptions.find((c) => c.id === aiTarget)?.label || '未命名章节'
    const newItems: PaperItem[] = picked.map((c, i) => ({
      key: `ai-${Date.now()}-${i}`, kind: 'ai', question: c.q,
      chapterTitle: c.q.chapter || chapter, includeInPrint: false
    }))
    setItems((list) => [...list, ...newItems])
    setShortfall((n) => Math.max(0, n - picked.length))
    setAiCandidates([])
    toast(`已加入 ${picked.length} 道 AI 生成题（默认不打印、不进错题库）`, 'ok')
  }

  const saveTemplate = async () => {
    const name = window.prompt('给这次组卷配置起个名字，例如「高一数学必修一·第一章」')
    if (!name?.trim()) return
    try { await saveQuizTemplate(name.trim(), cfg); setTemplates(await listQuizTemplates()); toast('模板已保存，下次可一键复用', 'ok') }
    catch (e: any) { toast('保存模板失败：' + e.message, 'err') }
  }

  const realItems = items.filter((i) => i.kind === 'real')
  const aiItems = items.filter((i) => i.kind === 'ai')
  const markedCount = Object.keys(mode === 'random' ? results : tbResults).length
  const bookOptions = useMemo(() => cfg.subject_id
    ? textbooks.filter((b) => b.subject_id === cfg.subject_id)
    : textbooks, [textbooks, cfg.subject_id])

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-xl font-bold text-slate-800">组卷 / 错题重练</h1>
        <p className="muted">两种模式都只抽真实错题；按课本抽题完全不依赖 AI，关闭 AI 后照常可用。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setMode('random')} className={`chip ${mode === 'random' ? 'border-brand-400 bg-brand-50 text-brand-700' : ''}`}>
            <Shuffle size={14} className="mr-1 inline" /> 按条件随机组卷
          </button>
          <button onClick={() => setMode('textbook')} className={`chip ${mode === 'textbook' ? 'border-brand-400 bg-brand-50 text-brand-700' : ''}`}>
            <BookOpen size={14} className="mr-1 inline" /> 按科目课本组卷
          </button>
        </div>
      </div>

      {/* ======================= 模式一：原有随机组卷 ======================= */}
      {mode === 'random' && (
        <>
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
                      <ResultButtons id={m.id} value={results[m.id]} onPick={(v) => setResults((r) => ({ ...r, [m.id]: v }))} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ======================= 模式二：按科目课本组卷 ======================= */}
      {mode === 'textbook' && (
        <>
          <div className="no-print card p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Sel label="① 科目" value={cfg.subject_id} onChange={(v) => setCfg((c) => ({ ...c, subject_id: v, textbook_id: '', chapter_ids: [] }))}
                options={subjects.map((s) => [s.id, s.name])} />
              <Sel label="② 课本（版本由你选）" value={cfg.textbook_id}
                onChange={(v) => setCfg((c) => ({ ...c, textbook_id: v, chapter_ids: [] }))}
                options={bookOptions.map((b) => [b.id, `${b.name}${b.edition ? ` · ${b.edition}` : ''}`])} />
              <div><label className="label">题量（1-50）</label>
                <input className="input" type="number" min={1} max={50} value={cfg.count} onChange={(e) => setCfgField('count', Number(e.target.value) || 10)} /></div>
              <div><label className="label">只抽未掌握 / 错过的题</label>
                <label className="flex h-10 items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" className="accent-brand-600" checked={cfg.only_weak}
                    onChange={(e) => setCfgField('only_weak', e.target.checked)} /> 排除已掌握且没再错的题
                </label></div>
              <div><label className="label">难度下限</label>
                <select className="input" value={cfg.difficulty_min} onChange={(e) => setCfgField('difficulty_min', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} 星</option>)}
                </select></div>
              <div><label className="label">难度上限</label>
                <select className="input" value={cfg.difficulty_max} onChange={(e) => setCfgField('difficulty_max', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} 星</option>)}
                </select></div>
            </div>
            <div><label className="label">③ 选择章节（可多选，可选到章或节；支持搜索标题）</label>
              <ChapterSelector textbookId={cfg.textbook_id} value={cfg.chapter_ids}
                onChange={(ids) => setCfg((c) => ({ ...c, chapter_ids: ids }))} /></div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => void drawTextbook()}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />} 按章节抽题（真实错题）
              </button>
              <button className="btn-ghost" onClick={sendPrint}><Printer size={15} /> 生成练习卷 / 打印 / PDF</button>
              <button className="btn-ghost" onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? '隐藏答案' : '显示答案（答案版）'}</button>
              <button className="btn-ghost" onClick={() => void saveTemplate()}><Save size={15} /> 保存为模板</button>
            </div>
            {templates.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
                <span className="text-xs text-slate-500">已存模板（一键复用）：</span>
                {templates.map((t) => (
                  <span key={t.id} className="chip">
                    <button onClick={() => { setCfg({ ...DEFAULT_CFG, ...t.config }); toast(`已套用「${t.name}」`, 'ok') }}>{t.name}</button>
                    <button className="ml-1 text-rose-500" title="删除模板" onClick={async () => {
                      await deleteQuizTemplate(t.id); setTemplates(await listQuizTemplates())
                    }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400">抽题优先级：① 直接关联到章节的错题 → ② 错题知识点/标签命中章节映射 → ③ 不足时询问是否用 AI 基于你上传的课本材料补充。</p>
          </div>

          {/* 错题不足 → AI 补充出题入口（关闭 AI 时置灰并说明，不发起任何调用） */}
          {shortfall > 0 && (
            <div className={`no-print card p-4 ${aiAvailable && targetReady ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex flex-wrap items-start gap-3">
                <AlertTriangle size={18} className={aiAvailable && targetReady ? 'text-amber-600' : 'text-slate-400'} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-700">
                    {aiAvailable
                      ? `该章节错题不足 ${shortfall} 道，是否用 AI 基于你上传的课本材料补充生成？`
                      : `该章节错题不足 ${shortfall} 道（真实错题已全部抽出）`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {!aiAvailable
                      ? `AI 补充出题不可用：${aiReason}。按课本抽真实错题不受影响，可放宽难度范围或增加章节。`
                      : !targetReady
                        ? '所选章节还没有课本材料或章节摘要，AI 补充出题已置灰。请先到「课本 → 章节详情」上传图片/PDF 片段或填写摘要。'
                        : '调用只会使用你上传的课本材料与章节摘要；结果先预览、逐题确认，默认不打印、不进错题库。'}
                  </div>
                  {aiAvailable && chapterOptions.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-slate-500">目标章节（必须有材料）：</label>
                      <select className="input max-w-xs py-1.5 text-xs" value={aiTarget} onChange={(e) => setAiTarget(e.target.value)}>
                        <option value="">请选择</option>
                        {aiChapterIds.map((id) => (
                          <option key={id} value={id}>{chapterOptions.find((c) => c.id === id)?.label || id}{materialReady[id] ? '（有材料）' : '（无材料）'}</option>
                        ))}
                      </select>
                      <span className={`badge ${targetReady ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        课本材料：{targetReady ? '已具备' : '未上传'}
                      </span>
                    </div>
                  )}
                </div>
                <button className="btn-primary disabled:opacity-50" disabled={!aiButtonEnabled}
                  onClick={() => setAiConfirmOpen(true)}>
                  {aiLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} AI 补充出题（{Math.min(10, shortfall)} 道）
                </button>
              </div>
            </div>
          )}

          {/* AI 候选预览：必须先逐题确认才写入组卷结果 */}
          {aiCandidates.length > 0 && (
            <div className="no-print card p-4">
              <h2 className="section-title flex items-center gap-2"><Sparkles size={16} /> AI 候选题预览（未确认前不进入组卷结果）</h2>
              <p className="muted mt-1">全部标注「AI生成，需核对，可能偏离课本」；可编辑、删除、单题重新生成。确认后才加入本卷，仍然默认不打印、不进错题库。</p>
              <div className="mt-3 space-y-2">
                {aiCandidates.map((c, idx) => (
                  <div key={idx} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <input type="checkbox" className="mt-1 accent-brand-600" checked={c.confirmed}
                        onChange={(e) => setAiCandidates((l) => l.map((x, i) => i === idx ? { ...x, confirmed: e.target.checked } : x))} />
                      <div className="min-w-0 flex-1">
                        <span className="badge bg-amber-100 text-amber-800">AI生成，需核对，可能偏离课本</span>
                        {editingIdx === idx ? (
                          <AiQuestionEditor q={c.q} onSave={(q) => { setAiCandidates((l) => l.map((x, i) => i === idx ? { ...x, q } : x)); setEditingIdx(null) }}
                            onCancel={() => setEditingIdx(null)} />
                        ) : (
                          <>
                            <div className="mt-2 text-sm text-slate-800">{c.q.stem}</div>
                            {c.q.options?.length > 0 && <div className="mt-1 text-xs text-slate-600">{c.q.options.join('　')}</div>}
                            <div className="mt-1 text-xs text-slate-600"><b>答案：</b>{c.q.answer}</div>
                            <div className="mt-1 text-xs text-slate-500"><b>解析：</b>{c.q.analysis}</div>
                            <div className="mt-1 text-xs text-slate-400">对应章节：{c.q.chapter} · 难度 ★{c.q.difficulty} · {c.q.confidence_note}</div>
                          </>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button className="btn-ghost py-1 text-xs" title="编辑" onClick={() => setEditingIdx(idx)}><Pencil size={13} /></button>
                        <button className="btn-ghost py-1 text-xs" title="重新生成单题" disabled={!!aiLoading}
                          onClick={() => void regenerateOne(idx)}>{aiLoading === `regen-${idx}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
                        <button className="btn-ghost py-1 text-xs text-rose-600" title="删除"
                          onClick={() => setAiCandidates((l) => l.filter((_, i) => i !== idx))}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary" onClick={confirmAiCandidates}><Check size={15} /> 把已确认的题加入组卷结果</button>
                <button className="btn-ghost" onClick={() => setAiCandidates([])}>全部放弃</button>
              </div>
            </div>
          )}

          {/* 组卷结果：来源章节列 + 真实错题 / AI生成 标签 */}
          {items.length > 0 && (
            <>
              <div className="no-print card flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="flex-1">本卷共 {items.length} 题 · 真实错题 {realItems.length} · AI 生成 {aiItems.length} · 已标记 {markedCount} 题</span>
                <button className="btn-primary" onClick={saveResults}><Check size={15} /> 保存重练结果</button>
              </div>
              <div className="no-print card hidden grid-cols-[1fr_180px_120px] gap-2 border-b border-slate-100 p-3 text-xs font-semibold text-slate-500 sm:grid">
                <span>题目</span><span>来源章节</span><span>题目属性</span>
              </div>
              <div className="space-y-3">
                {items.map((it, i) => it.kind === 'real' ? (
                  <div key={it.key} className="print-block card p-4">
                    <div className="grid gap-2 sm:grid-cols-[1fr_180px_120px]">
                      <h3 className="font-semibold text-slate-800">{i + 1}. {it.mistake.title}</h3>
                      <div className="text-xs text-slate-500"><span className="text-slate-400">来源章节：</span>{it.chapterTitle}</div>
                      <div><span className="badge bg-emerald-50 text-emerald-700">真实错题</span>
                        <span className="ml-1 text-xs text-slate-400">{it.matchType === 'direct' ? '直接关联' : '知识点命中'}</span></div>
                    </div>
                    <div className="tiptap mt-2 text-sm" dangerouslySetInnerHTML={{ __html: renderMath(it.mistake.content) }} />
                    {!!it.mistake.images?.length && <div className="mt-2 flex flex-wrap gap-2">{it.mistake.images.map((img) => img.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={img.id} src={img.signedUrl} loading="lazy" alt="题目图片" className="max-h-52 rounded border" />
                    ))}</div>}
                    {!showAnswer && <div className="mt-3 space-y-2">{[1, 2, 3].map((n) => <div key={n} className="h-4 border-b border-dashed border-slate-200" />)}</div>}
                    {showAnswer && (
                      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                        <div><b>答案：</b><span dangerouslySetInnerHTML={{ __html: renderMath(it.mistake.answer) }} /></div>
                        <div className="mt-1"><b>解析：</b><span dangerouslySetInnerHTML={{ __html: renderMath(it.mistake.analysis) }} /></div>
                        <div className="mt-1 text-xs text-slate-500">知识点：{it.mistake.knowledge_points.join('、') || '—'} · ★{it.mistake.difficulty}</div>
                      </div>
                    )}
                    <div className="no-print mt-3 flex flex-wrap gap-2">
                      <span className="muted self-center">本次结果：</span>
                      <ResultButtons id={it.mistake.id} value={tbResults[it.mistake.id]} onPick={(v) => setTbResults((r) => ({ ...r, [it.mistake.id]: v }))} />
                    </div>
                  </div>
                ) : (
                  <div key={it.key} className="print-block card border-amber-200 bg-amber-50/30 p-4">
                    <div className="grid gap-2 sm:grid-cols-[1fr_180px_120px]">
                      <h3 className="font-semibold text-slate-800">{i + 1}. {it.question.stem}</h3>
                      <div className="text-xs text-slate-500"><span className="text-slate-400">来源章节：</span>{it.chapterTitle}</div>
                      <div><span className="badge bg-amber-100 text-amber-800">AI生成，需核对，可能偏离课本</span>
                        <div className="mt-1 text-[10px] text-amber-700">不进错题库 / 不参与随机抽题</div></div>
                    </div>
                    {it.question.options?.length > 0 && <div className="mt-2 text-sm text-slate-700">{it.question.options.join('　')}</div>}
                    {showAnswer && (
                      <div className="mt-3 rounded-lg bg-white p-3 text-sm">
                        <div><b>答案：</b>{it.question.answer}</div>
                        <div className="mt-1"><b>解析：</b>{it.question.analysis}</div>
                        <div className="mt-1 text-xs text-slate-400">难度 ★{it.question.difficulty} · {it.question.confidence_note}</div>
                      </div>
                    )}
                    <div className="no-print mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <label className="flex items-center gap-1.5 text-slate-600">
                        <input type="checkbox" className="accent-brand-600" checked={it.includeInPrint}
                          onChange={(e) => setItems((l) => l.map((x) => x.key === it.key && x.kind === 'ai' ? { ...x, includeInPrint: e.target.checked } : x))} />
                        加入学生版打印（默认不勾选）
                      </label>
                      <span className="text-slate-400">AI 题不进错题库、不参与后续随机抽题</span>
                      <button className="btn-ghost py-1 text-xs text-rose-600" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                        <Trash2 size={13} /> 移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <ConfirmDialog open={aiConfirmOpen} title="确认调用 AI 基于课本材料补充出题？"
        description="只有你已上传的课本材料与章节摘要会作为出题依据；服务端会再次校验材料是否充足，材料不足时返回原因而不是编题。结果必须逐题确认后才进入组卷，默认不打印、不进入错题库。本次调用会消耗 Coding Plan 配额。"
        confirmText="确认调用" danger={false} onClose={() => setAiConfirmOpen(false)}
        onConfirm={() => { setAiConfirmOpen(false); void callAi() }} />
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

function ResultButtons({ id, value, onPick }: { id: string; value?: ReviewResult; onPick: (v: ReviewResult) => void }) {
  return (
    <>
      <button className={`btn-ghost ${value === 'again' ? 'border-rose-400 text-rose-600' : 'text-rose-600'}`} onClick={() => onPick('again')}><X size={14} /> 又错</button>
      <button className={`btn-ghost ${value === 'fuzzy' ? 'border-amber-400 text-amber-600' : 'text-amber-600'}`} onClick={() => onPick('fuzzy')}><HelpCircle size={14} /> 模糊</button>
      <button className={`btn-ghost ${value === 'mastered' ? 'border-emerald-400 text-emerald-600' : 'text-emerald-600'}`} onClick={() => onPick('mastered')}><Check size={14} /> 已掌握</button>
    </>
  )
}

/** 单题编辑（只改内存中的 AI 候选，不改数据库） */
function AiQuestionEditor({ q, onSave, onCancel }: { q: AiQuizQuestion; onSave: (q: AiQuizQuestion) => void; onCancel: () => void }) {
  const [d, setD] = useState({
    stem: q.stem, options: (q.options || []).join('\n'), answer: q.answer,
    analysis: q.analysis, difficulty: String(q.difficulty)
  })
  return (
    <div className="mt-2 space-y-2">
      <textarea className="input min-h-[60px] text-xs" value={d.stem} onChange={(e) => setD({ ...d, stem: e.target.value })} placeholder="题干" />
      <textarea className="input min-h-[50px] text-xs" value={d.options} onChange={(e) => setD({ ...d, options: e.target.value })} placeholder="选项（每行一个，可留空）" />
      <input className="input text-xs" value={d.answer} onChange={(e) => setD({ ...d, answer: e.target.value })} placeholder="答案" />
      <textarea className="input min-h-[50px] text-xs" value={d.analysis} onChange={(e) => setD({ ...d, analysis: e.target.value })} placeholder="解析" />
      <div className="flex items-center gap-2">
        <select className="input max-w-[110px] py-1 text-xs" value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value })}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>★{n}</option>)}
        </select>
        <button className="btn-primary py-1 text-xs" onClick={() => onSave({
          ...q, stem: d.stem, options: d.options.split('\n').map((s) => s.trim()).filter(Boolean),
          answer: d.answer, analysis: d.analysis, difficulty: Number(d.difficulty) || 3
        })}>保存修改</button>
        <button className="btn-ghost py-1 text-xs" onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}
