'use client'

import { useEffect, useState } from 'react'
import { Printer, Save, Trash2, FileDown } from 'lucide-react'
import { PrintDocument } from '@/components/PrintDocument'
import { useToast } from '@/components/Toast'
import { useAi } from '@/components/AiProvider'
import { getMistake, listMistakes, listPrintTemplates, savePrintTemplate } from '@/lib/data'
import { DEFAULT_PRINT_OPTIONS, VARIANT_LABEL, type Mistake, type PrintOptions, type PrintTemplate, type PrintVariant } from '@/types'

const OPTION_LABELS: { key: keyof PrintOptions; label: string }[] = [
  { key: 'showAnswer', label: '答案' }, { key: 'showAnalysis', label: '解析' },
  { key: 'showKnowledge', label: '知识点' }, { key: 'showTags', label: '标签' },
  { key: 'showImages', label: '图片（含整题原图）' }, { key: 'showCause', label: '错因' },
  { key: 'showReviewAdvice', label: '复习建议' }, { key: 'showHeader', label: '页眉信息' },
  { key: 'showCroppedImages', label: '手动裁剪图' }, { key: 'showAiFigureDescription', label: 'AI 图形描述（默认不打印）' }
]

export default function PrintPage() {
  const toast = useToast()
  const ai = useAi()
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('错题练习卷')
  const [variant, setVariant] = useState<PrintVariant>('student')
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS)
  const [templates, setTemplates] = useState<PrintTemplate[]>([])
  const [source, setSource] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const q = new URLSearchParams(window.location.search)
        const ids = q.get('ids')?.split(',').filter(Boolean) || []
        const filter = q.get('filter')
        const paperIds = JSON.parse(sessionStorage.getItem('practice-paper') || '[]') as string[]
        if (ids.length) { setMistakes(await Promise.all(ids.map(getMistake))); setSource(`选中 ${ids.length} 道错题`) }
        else if (filter) { const r = await listMistakes({ ...JSON.parse(filter), pageSize: 200 }); setMistakes(r.rows); setSource(`筛选结果 ${r.rows.length} 道`) }
        else if (paperIds.length) { setMistakes(await Promise.all(paperIds.map(getMistake))); setSource(`随机组卷 ${paperIds.length} 道`); setVariant('answer') }
        else { const r = await listMistakes({ pageSize: 20 }); setMistakes(r.rows); setSource('最近 20 道（默认）') }
        setTemplates(await listPrintTemplates())
      } catch (e: any) { toast('加载打印数据失败：' + e.message, 'err') }
      finally { setLoading(false) }
    }
    void load()
  }, [])

  const saveTemplate = async () => {
    const name = window.prompt('给这套打印配置起个名字，例如「周末复习卷」')
    if (!name?.trim()) return
    try { await savePrintTemplate({ name: name.trim(), variant, options, is_default: false }); setTemplates(await listPrintTemplates()); toast('模板已保存，可在设置页管理', 'ok') }
    catch (e: any) { toast('保存失败：' + e.message, 'err') }
  }

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-xl font-bold text-slate-800">打印预览</h1>
        <p className="muted">{source} · A4 自动分页，题目与图片不会跨页截断。点「打印 / 导出PDF」后在对话框里选「另存为 PDF」即可导出。</p>
      </div>

      <div className="no-print card p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">卷子标题</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label">打印模板</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(VARIANT_LABEL) as PrintVariant[]).map((v) => (
                <button key={v} onClick={() => setVariant(v)} className={`chip ${variant === v ? 'border-brand-400 bg-brand-50 text-brand-700' : ''}`}>
                  {VARIANT_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <label className="label">打印内容（勾选要出现在纸上的字段）</label>
          <div className="flex flex-wrap gap-3">
            {OPTION_LABELS.map((o) => (
              <label key={o.key} className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" className="accent-brand-600" checked={options[o.key]}
                  onChange={(e) => setOptions((p) => ({ ...p, [o.key]: e.target.checked }))} /> {o.label}
              </label>
            ))}
          </div>
        </div>

        {templates.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">已存模板：</span>
            {templates.map((t) => (
              <button key={t.id} className="chip" onClick={() => { setVariant(t.variant); setOptions(t.options); toast(`已套用「${t.name}」`, 'ok') }}>{t.name}</button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> 打印 / 导出PDF</button>
          <button className="btn-ghost" onClick={saveTemplate}><Save size={15} /> 保存为模板</button>
          <button className="btn-ghost" onClick={() => { setOptions(DEFAULT_PRINT_OPTIONS); setVariant('student') }}><Trash2 size={15} /> 恢复默认</button>
          <span className="muted self-center"><FileDown size={14} className="mr-1 inline" />导出 PDF 无需后端：打印对话框 → 目标选择「另存为 PDF」</span>
        </div>
      </div>

      {loading ? <div className="card p-10 text-center text-sm text-slate-400">正在准备打印内容…</div> : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <PrintDocument mistakes={mistakes} options={options} variant={variant} title={title} aiEnabled={ai.can('similar')} />
        </div>
      )}
    </div>
  )
}
