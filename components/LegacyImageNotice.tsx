'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Wand2 } from 'lucide-react'
import { useToast } from './Toast'

/** 客户端本地计数（不 import 服务端模块，避免把服务端依赖带进浏览器包） */
const countLegacyBase64 = (s: string | null | undefined) => (String(s || '').match(/src\s*=\s*["']data:image\//gi) || []).length

/**
 * 历史 Base64 富文本图片提示 + 一键迁移入口。
 * 新图片不会再产生 Base64（Tiptap allowBase64:false + 统一走 Storage）。
 */
export function LegacyImageNotice({
  mistakeId, html, onMigrated
}: {
  mistakeId: string
  html: { content: string; answer: string; analysis: string }
  onMigrated: (f: { content: string; answer: string; analysis: string }) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const n = countLegacyBase64(html.content) + countLegacyBase64(html.answer) + countLegacyBase64(html.analysis)
  if (!n || dismissed) return null

  const run = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/images/migrate-inline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistakeId, fields: html })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '迁移失败')
      onMigrated({
        content: j.fields?.content ?? html.content,
        answer: j.fields?.answer ?? html.answer,
        analysis: j.fields?.analysis ?? html.analysis
      })
      if (j.warnings?.length) toast(`${j.message}；但有 ${j.warnings.length} 条需手动处理：${j.warnings[0]}`, 'err')
      else toast(j.message, 'ok')
      if (!j.migrated) setDismissed(true)
    } catch (e: any) { toast(`迁移失败：${e?.message || '请稍后重试，原图未丢失'}`, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="no-print rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> 该图片存储方式需迁移（检测到 {n} 张 Base64 图片）</div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} 迁移到云端 Storage
          </button>
          <button type="button" className="btn-ghost" onClick={() => setDismissed(true)}>暂不处理</button>
        </div>
      </div>
      <p className="mt-1.5 text-xs">
        这些是旧版把图片数据直接写进正文留下的内容，会让题库变大、跨设备加载慢。迁移会上传到私有桶，正文只保留路径；
        <b>迁移脚本可重复执行，失败可重跑，原图不会被删除</b>。迁移前建议先导出一次 JSON 备份。
      </p>
    </div>
  )
}
