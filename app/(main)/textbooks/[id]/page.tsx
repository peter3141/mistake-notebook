'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, Upload, FileText, GripVertical, Save, Search,
  Link2, BookOpen, Loader2, ChevronDown, ChevronRight, ClipboardList, Image as ImageIcon
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  getTextbook, listChapterRows, buildChapterTree, parseCatalog, bulkImportChapters,
  upsertChapter, reorderChapters, softDeleteChapterWithRelations,
  listChapterKps, addChapterKp, removeChapterKp,
  listLinkedMistakes, linkMistakeToChapter, unlinkMistakeFromChapter, searchMistakesForLink,
  listMaterials, addTextMaterial, uploadTextbookMaterial, softDeleteMaterial, chapterMaterialState
} from '@/lib/textbooks'
import type {
  Textbook, TextbookChapter, ChapterKnowledgePoint, TextbookMaterial, TextbookMaterialType
} from '@/types'

const MATERIAL_LABEL: Record<TextbookMaterialType, string> = {
  catalog: '目录', text: '正文片段', example: '例题', image: '图片', pdf: 'PDF 片段'
}

export default function TextbookDetailPage() {
  const params = useParams<{ id: string }>()
  const bookId = params.id
  const toast = useToast()
  const [book, setBook] = useState<Textbook | null>(null)
  const [rows, setRows] = useState<TextbookChapter[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState('')
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [catalogText, setCatalogText] = useState('')
  const [delChapter, setDelChapter] = useState<TextbookChapter | null>(null)

  // 章节详情
  const [detail, setDetail] = useState({ title: '', chapter_no: '', page_range: '', summary: '' })
  const [kps, setKps] = useState<ChapterKnowledgePoint[]>([])
  const [newKp, setNewKp] = useState('')
  const [linked, setLinked] = useState<Array<{ id: string; title: string }>>([])
  const [mistakeQ, setMistakeQ] = useState('')
  const [mistakeHits, setMistakeHits] = useState<Array<{ id: string; title: string }>>([])
  const [materials, setMaterials] = useState<TextbookMaterial[]>([])
  const [matState, setMatState] = useState({ hasSummary: false, hasTextMaterial: false, hasFiles: false, ready: false })
  const [matFile, setMatFile] = useState<File | null>(null)
  const [matType, setMatType] = useState<TextbookMaterialType>('image')
  const [ocrText, setOcrText] = useState('')
  const [textMaterial, setTextMaterial] = useState('')

  const tree = useMemo(() => buildChapterTree(rows), [rows])
  const selected = rows.find((r) => r.id === selectedId) || null

  const load = async () => {
    const [b, chapters] = await Promise.all([getTextbook(bookId), listChapterRows(bookId)])
    setBook(b); setRows(chapters)
    setOpen((o) => ({ ...Object.fromEntries(chapters.filter((c) => c.level === 1).map((c) => [c.id, true])), ...o }))
    if (!selectedId && chapters.length) setSelectedId(chapters[0].id)
  }
  useEffect(() => { void load().catch((e) => toast('加载失败：' + e.message, 'err')) }, [bookId])

  const loadDetail = async (chapterId: string) => {
    const [k, l, m, state] = await Promise.all([
      listChapterKps(chapterId), listLinkedMistakes(chapterId),
      listMaterials(chapterId), chapterMaterialState(chapterId)
    ])
    setKps(k); setLinked(l); setMaterials(m); setMatState(state)
    const c = rows.find((r) => r.id === chapterId)
    if (c) setDetail({ title: c.title, chapter_no: c.chapter_no, page_range: c.page_range || '', summary: c.summary || '' })
  }
  useEffect(() => { if (selectedId) void loadDetail(selectedId).catch((e) => toast('章节详情加载失败：' + e.message, 'err')) }, [selectedId, rows])

  const parsed = useMemo(() => parseCatalog(catalogText), [catalogText])

  const addChapter = async (level: 1 | 2, parentId: string | null = null) => {
    const title = window.prompt(level === 1 ? '输入章标题，如「集合」' : '输入节标题，如「集合的概念」')
    if (!title?.trim()) return
    const no = window.prompt('章节序号（可留空），如「第一章」或「1.1」') || ''
    try {
      await upsertChapter({
        textbook_id: bookId, parent_id: parentId, level, chapter_no: no.trim(),
        title: title.trim(), sort_order: (rows.filter((r) => r.parent_id === parentId).length + 1) * 10
      })
      toast('章节已添加', 'ok'); await load()
    } catch (e: any) { toast('添加失败：' + e.message, 'err') }
  }

  const doImport = async () => {
    if (!parsed.length) return toast('没有解析出章节，请检查目录格式', 'err')
    setBusy(true)
    try {
      const n = await bulkImportChapters(bookId, parsed)
      toast(`已导入 ${n} 个章节（章 → 节两级）`, 'ok')
      setImportOpen(false); setCatalogText(''); await load()
    } catch (e: any) { toast('导入失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const dropOn = async (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const a = rows.find((r) => r.id === dragId), b = rows.find((r) => r.id === targetId)
    if (!a || !b) return
    if (a.parent_id !== b.parent_id) { toast('只能在同一层级内拖拽排序（章与章、同章下的节与节）', 'err'); return }
    const siblings = rows.filter((r) => r.parent_id === a.parent_id).sort((x, y) => x.sort_order - y.sort_order)
    const from = siblings.findIndex((r) => r.id === dragId), to = siblings.findIndex((r) => r.id === targetId)
    if (from < 0 || to < 0) return
    siblings.splice(to, 0, siblings.splice(from, 1)[0])
    try {
      await reorderChapters(siblings.map((r, i) => ({ id: r.id, sort_order: (i + 1) * 10 })))
      await load(); toast('排序已保存', 'ok')
    } catch (e: any) { toast('排序失败：' + e.message, 'err') }
    finally { setDragId('') }
  }

  const saveDetail = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await upsertChapter({
        title: detail.title.trim() || selected.title, chapter_no: detail.chapter_no.trim(),
        page_range: detail.page_range.trim() || null, summary: detail.summary
      }, selected.id)
      toast('章节内容摘要已保存（可作为 AI 出题的真实材料）', 'ok')
      await load(); await loadDetail(selected.id)
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const doDeleteChapter = async () => {
    if (!delChapter) return
    setBusy(true)
    try {
      await softDeleteChapterWithRelations(delChapter.id)
      toast('章节及其子节、材料已移入回收站（30 天内可恢复）', 'ok')
      setDelChapter(null); setSelectedId(''); await load()
    } catch (e: any) { toast('删除失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const uploadMaterial = async () => {
    if (!selected || !matFile) return toast('请先选择图片或 PDF 文件', 'err')
    setBusy(true)
    try {
      const type: TextbookMaterialType = matFile.type === 'application/pdf' ? 'pdf' : matType === 'text' ? 'image' : matType
      await uploadTextbookMaterial(selected.id, bookId, matFile, type, ocrText)
      toast('材料已上传：压缩后存 Storage，数据库只记路径', 'ok')
      setMatFile(null); setOcrText(''); await loadDetail(selected.id)
    } catch (e: any) { toast('上传失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const doSearchMistakes = async () => {
    try { setMistakeHits(await searchMistakesForLink(mistakeQ)) }
    catch (e: any) { toast('搜索失败：' + e.message, 'err') }
  }

  if (!book) return <div className="card p-8 text-center text-sm text-slate-400">正在加载课本…</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/textbooks" className="btn-ghost"><ArrowLeft size={16} /> 课本列表</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800">{book.name} · 章节树</h1>
          <p className="muted">{book.subject?.name || '未设科目'} · {book.publisher} {book.edition} · {book.grade} {book.volume}</p>
        </div>
        <button className="btn-ghost" onClick={() => setImportOpen(true)}><ClipboardList size={16} /> 粘贴目录批量导入</button>
        <button className="btn-primary" onClick={() => void addChapter(1)}><Plus size={16} /> 新增章</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* 章节树 */}
        <section className="card p-3">
          <h2 className="section-title">章节（两级：章 → 节）</h2>
          <p className="muted mt-1">拖动标题可同级排序；点章节标题在右侧录入摘要、材料与映射。</p>
          <div className="mt-3 space-y-1">
            {tree.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-400">还没有章节，点「粘贴目录批量导入」或「新增章」</div>}
            {tree.map((ch) => (
              <div key={ch.id}>
                <div draggable onDragStart={() => setDragId(ch.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => void dropOn(ch.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 ${selectedId === ch.id ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-slate-50'}`}>
                  <GripVertical size={14} className="shrink-0 cursor-grab text-slate-300" />
                  <button className="text-slate-400" onClick={() => setOpen((o) => ({ ...o, [ch.id]: !(o[ch.id] ?? true) }))}>
                    {(open[ch.id] ?? true) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button className="flex-1 truncate text-left text-sm font-medium text-slate-700" onClick={() => setSelectedId(ch.id)}>
                    <span className="mr-1 text-slate-400">{ch.chapter_no}</span>{ch.title}
                  </button>
                  <button className="btn-ghost px-1.5 py-1 text-xs" title="在本章下新增节" onClick={() => void addChapter(2, ch.id)}><Plus size={13} /></button>
                  <button className="btn-ghost px-1.5 py-1 text-xs text-rose-600" title="删除本章" onClick={() => setDelChapter(ch)}><Trash2 size={13} /></button>
                </div>
                {(open[ch.id] ?? true) && (ch.children || []).map((s) => (
                  <div key={s.id} draggable onDragStart={() => setDragId(s.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => void dropOn(s.id)}
                    className={`ml-7 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${selectedId === s.id ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-slate-50'}`}>
                    <GripVertical size={13} className="shrink-0 cursor-grab text-slate-300" />
                    <button className="flex-1 truncate text-left text-sm text-slate-600" onClick={() => setSelectedId(s.id)}>
                      <span className="mr-1 text-slate-400">{s.chapter_no}</span>{s.title}
                    </button>
                    <button className="btn-ghost px-1.5 py-1 text-xs text-rose-600" title="删除本节" onClick={() => setDelChapter(s)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* 章节详情 */}
        <section className="space-y-3">
          {!selected ? <div className="card p-8 text-center text-sm text-slate-400">在左侧选择一个章节</div> : (
            <>
              <div className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="section-title">{selected.level === 1 ? '章' : '节'}详情：{selected.chapter_no} {selected.title}</h2>
                  <span className={`badge ${matState.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {matState.ready ? '已有真实课本材料' : '尚无可用课本材料'}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><label className="label">章节标题</label><input className="input" value={detail.title} onChange={(e) => setDetail((d) => ({ ...d, title: e.target.value }))} /></div>
                  <div><label className="label">章节序号</label><input className="input" value={detail.chapter_no} onChange={(e) => setDetail((d) => ({ ...d, chapter_no: e.target.value }))} /></div>
                  <div className="sm:col-span-2"><label className="label">页码范围（可选）</label><input className="input" value={detail.page_range} onChange={(e) => setDetail((d) => ({ ...d, page_range: e.target.value }))} placeholder="如 P1–P12" /></div>
                  <div className="sm:col-span-2">
                    <label className="label">章节内容摘要（AI 出题的可信材料之一，建议 ≥10 字）</label>
                    <textarea className="input min-h-[90px]" value={detail.summary} onChange={(e) => setDetail((d) => ({ ...d, summary: e.target.value }))}
                      placeholder="粘贴课本正文片段 / 定义 / 公式。AI 只能基于这里和你上传的材料出题。" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => void saveDetail()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 保存章节</button>
                  <span className="text-xs text-slate-400">
                    材料：摘要 {matState.hasSummary ? '✓' : '—'} · 文字材料 {matState.hasTextMaterial ? '✓' : '—'} · 文件 {matState.hasFiles ? '✓' : '—'}
                    （没上传材料或未填摘要时，AI 补充出题不可用）
                  </span>
                </div>
              </div>

              {/* 材料 */}
              <div className="card p-4">
                <h2 className="section-title flex items-center gap-2"><Upload size={16} /> 课本材料</h2>
                <p className="muted mt-1">图片先压缩再进 Storage；PDF 只存片段。数据库只记路径与 OCR 文本，不存 Base64。</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="btn-ghost cursor-pointer py-1.5 text-xs">
                    <ImageIcon size={14} /> 选择图片 / PDF
                    <input type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={(e) => setMatFile(e.target.files?.[0] || null)} />
                  </label>
                  <select className="input max-w-[140px] py-1.5 text-xs" value={matType} onChange={(e) => setMatType(e.target.value as TextbookMaterialType)}>
                    <option value="image">课本图片</option><option value="catalog">目录</option>
                    <option value="example">例题</option><option value="pdf">PDF 片段</option>
                  </select>
                  <span className="truncate text-xs text-slate-500">{matFile?.name || '未选择文件'}</span>
                  <button className="btn-primary py-1.5 text-xs" disabled={!matFile || busy} onClick={() => void uploadMaterial()}>上传</button>
                </div>
                <div className="mt-2">
                  <label className="label">OCR 文本 / 图片里的正文（可选，AI 出题会以它为依据）</label>
                  <textarea className="input min-h-[60px] text-xs" value={ocrText} onChange={(e) => setOcrText(e.target.value)}
                    placeholder="把课本片段的文字粘贴在这里；纯图片材料没有文字时 AI 会提示材料不足，不会编题" />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <textarea className="input min-h-[50px] flex-1 text-xs" value={textMaterial} onChange={(e) => setTextMaterial(e.target.value)} placeholder="或直接录入课本正文 / 例题文字（不上传文件）" />
                  <button className="btn-ghost py-1.5 text-xs" disabled={!textMaterial.trim() || busy} onClick={async () => {
                    try { await addTextMaterial(selected.id, bookId, textMaterial, 'text'); setTextMaterial(''); await loadDetail(selected.id); toast('已录入课本片段', 'ok') }
                    catch (e: any) { toast('录入失败：' + e.message, 'err') }
                  }}><FileText size={14} /> 录入文字材料</button>
                </div>

                {materials.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {materials.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-xs">
                        <span className="badge">{MATERIAL_LABEL[m.material_type] || m.material_type}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-600">{m.file_name || '课本片段'}</span>
                        {m.signedUrl && <a href={m.signedUrl} target="_blank" rel="noreferrer" className="text-brand-600">预览</a>}
                        <span className="text-slate-400">{Math.round((m.size_bytes || 0) / 1024)}KB</span>
                        <button className="btn-ghost px-1.5 py-1 text-rose-600" title="移入回收站" onClick={async () => {
                          try { await softDeleteMaterial(m.id); await loadDetail(selected.id); toast('材料已移入回收站', 'ok') }
                          catch (e: any) { toast('删除失败：' + e.message, 'err') }
                        }}><Trash2 size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 知识点映射 */}
              <div className="card p-4">
                <h2 className="section-title">知识点映射（章节 ↔ 知识点）</h2>
                <p className="muted mt-1">错题的知识点或标签命中这里，就会被间接抽进该章节的试卷。</p>
                <div className="mt-3 flex gap-2">
                  <input className="input" value={newKp} onChange={(e) => setNewKp(e.target.value)} placeholder="如：集合的包含关系" />
                  <button className="btn-ghost" onClick={async () => {
                    if (!newKp.trim()) return
                    try { await addChapterKp(selected.id, newKp); setNewKp(''); await loadDetail(selected.id) }
                    catch (e: any) { toast('添加失败：' + e.message, 'err') }
                  }}><Plus size={15} /> 添加</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {kps.length === 0 && <span className="text-xs text-slate-400">还没有映射知识点</span>}
                  {kps.map((k) => (
                    <span key={k.id} className="chip">
                      {k.knowledge_point} <span className="text-slate-400">×{Number(k.weight)}</span>
                      <button className="ml-1 text-rose-500" onClick={async () => { await removeChapterKp(k.id); await loadDetail(selected.id) }}>×</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* 错题关联 */}
              <div className="card p-4">
                <h2 className="section-title flex items-center gap-2"><Link2 size={16} /> 直接关联错题</h2>
                <p className="muted mt-1">关联后该错题会被优先抽中；不关联也能通过上面的知识点间接命中。</p>
                <div className="mt-3 flex gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                    <input className="input pl-8" value={mistakeQ} onChange={(e) => setMistakeQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void doSearchMistakes() }} placeholder="搜索错题标题 / 内容" />
                  </div>
                  <button className="btn-ghost" onClick={() => void doSearchMistakes()}><Search size={15} /> 搜索</button>
                </div>
                {mistakeHits.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {mistakeHits.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1.5 text-xs">
                        <BookOpen size={13} className="text-slate-400" />
                        <span className="flex-1 truncate">{m.title}</span>
                        <button className="btn-ghost py-1 text-xs" onClick={async () => {
                          try { await linkMistakeToChapter(selected.id, m.id); await loadDetail(selected.id); toast('已关联', 'ok') }
                          catch (e: any) { toast('关联失败：' + e.message, 'err') }
                        }}>关联</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3">
                  <label className="label">已关联 {linked.length} 道</label>
                  <div className="flex flex-wrap gap-1.5">
                    {linked.length === 0 && <span className="text-xs text-slate-400">无</span>}
                    {linked.map((m) => (
                      <span key={m.id} className="chip">{m.title}
                        <button className="ml-1 text-rose-500" onClick={async () => {
                          await unlinkMistakeFromChapter(selected.id, m.id); await loadDetail(selected.id)
                        }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* 粘贴目录批量导入 */}
      {importOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setImportOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-800">粘贴目录，自动解析成章 → 节</h2>
            <p className="muted mt-1">支持「第一章 集合 / 1.1 集合的概念 / 1.2 …」这类格式；自动去掉点线与页码。整本 PDF 自动解析为章节树未实现，只支持粘贴目录或手动录入。</p>
            <textarea className="input mt-3 min-h-[180px] font-mono text-xs" value={catalogText} onChange={(e) => setCatalogText(e.target.value)}
              placeholder={'第一章 集合\n1.1 集合的概念\n1.2 集合间的基本关系\n第二章 函数\n2.1 函数的概念\n2.2 函数的单调性'} />
            <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-slate-100 p-2 text-xs">
              {parsed.length === 0 ? <p className="text-slate-400">解析预览会显示在这里</p> : parsed.map((p, i) => (
                <div key={i} className={`${p.level === 1 ? 'font-semibold text-slate-700' : 'ml-6 text-slate-500'} py-0.5`}>
                  {p.level === 1 ? '📘' : '·'} {p.chapter_no} {p.title}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">共解析 {parsed.length} 条：章 {parsed.filter((p) => p.level === 1).length} / 节 {parsed.filter((p) => p.level === 2).length}</span>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setImportOpen(false)}>取消</button>
                <button className="btn-primary" disabled={!parsed.length || busy} onClick={() => void doImport()}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} 确认导入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!delChapter} title={`删除章节「${delChapter?.chapter_no || ''} ${delChapter?.title || ''}」？`} busy={busy}
        description="该章节、其下的节、课本材料会一起移入统一回收站（30 天内可恢复）；知识点映射与错题关联会随章节不再参与抽题，错题本身不会被删除。请在回收站恢复或彻底删除。"
        confirmText="移入回收站" requireText="删除" onConfirm={doDeleteChapter} onClose={() => setDelChapter(null)} />
    </div>
  )
}
