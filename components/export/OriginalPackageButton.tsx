'use client'

import { useEffect, useState } from 'react'
import { Package, Loader2 } from 'lucide-react'
import { listBooks } from '@/lib/data'
import { saveBase64File } from '@/lib/images/client'
import { useToast } from '../Toast'
import { toDateInput } from '@/lib/utils'

/** 导出原图包：按时间范围 / 错题本打包下载图片 zip（本地离线副本，网页不依赖它） */
export function OriginalPackageButton() {
  const toast = useToast()
  const [books, setBooks] = useState<any[]>([])
  const [bookId, setBookId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => { void listBooks().then(setBooks).catch(() => {}) }, [])

  const run = async () => {
    setBusy(true); setProgress('准备导出')
    try {
      const r = await fetch('/api/export/originals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(bookId ? { bookId } : {}),
          ...(from ? { dateFrom: from } : {}),
          ...(to ? { dateTo: to } : {}),
          imageRoles: ['original', 'cropped', 'inline']
        })
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({} as any))).error || '导出失败')
      if (!r.body) throw new Error('服务端未返回数据流')

      const reader = r.body.getReader(), decoder = new TextDecoder()
      let buf = ''
      let file: { name: string; mime: string; base64: string; warnings?: string[] } | null = null
      const handle = (line: string) => {
        if (!line.trim()) return
        let msg: any
        try { msg = JSON.parse(line) } catch { return }
        if (msg.type === 'progress') setProgress(`${msg.stage}（${msg.done}/${msg.total}）`)
        else if (msg.type === 'error') throw new Error(msg.error || '导出失败')
        else if (msg.type === 'file') file = msg
      }
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() || ''
        lines.forEach(handle)
      }
      if (buf.trim()) handle(buf)
      if (!file) throw new Error('未收到导出文件')
      const f = file as { name: string; mime: string; base64: string; warnings?: string[] }
      saveBase64File(f.name, f.mime, f.base64)
      toast(f.warnings?.length ? `已下载，但有 ${f.warnings.length} 条提示：${f.warnings[0]}` : '原图包已下载，请存到网盘或U盘', f.warnings?.length ? 'err' : 'ok')
    } catch (e: any) {
      toast(`导出失败：${e?.message || '请检查网络与存储配置'}`, 'err')
    } finally { setBusy(false); setProgress('') }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="muted">错题本
          <select value={bookId} onChange={(e) => setBookId(e.target.value)} className="ml-1 rounded border border-slate-300 px-2 py-1">
            <option value="">全部</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="muted">从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
        <label className="muted">到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1" /></label>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void run()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Package size={15} />} 导出原图包（zip）
        </button>
        {progress && <span className="muted">{progress}</span>}
      </div>
      <p className="muted">
        打包的是云端压缩图（含<b>整题原图</b>与<b>手动裁剪图</b>），包内 <code>清单.txt</code> 说明每张图对应哪道错题。
        这是<b>离线副本</b>：网页展示/打印/分享/AI OCR 一律从 Supabase Storage 取图，<b>不读你电脑里的文件，也不需要电脑常开</b>；换电脑或重装系统网站里的图不会丢。
      </p>
    </div>
  )
}
