'use client'

import { useEffect, useState } from 'react'
import { ScanLine, ScanText, HardDriveDownload, WifiOff, Save } from 'lucide-react'
import {
  LOCAL_OCR_LANGS, LOCAL_OCR_DOWNLOAD, readLocalOcrLangs, saveLocalOcrLangs
} from '@/lib/ocr/local-ocr'
import { useToast } from '@/components/Toast'

/** 设置页：明确区分「AI OCR」与「本地 OCR」，并管理本地语言包 */
export function LocalOcrSettings() {
  const toast = useToast()
  const [extra, setExtra] = useState<string[]>([])
  const [current, setCurrent] = useState('chi_sim+eng')

  useEffect(() => {
    const v = readLocalOcrLangs()
    setCurrent(v)
    setExtra(v.split('+').filter((c) => c !== 'chi_sim' && c !== 'eng'))
  }, [])

  const toggle = (code: string) => setExtra((p) => p.includes(code) ? p.filter((x) => x !== code) : [...p, code])

  const save = () => {
    const next = saveLocalOcrLangs(extra)
    setCurrent(next)
    toast(`已保存：${next}（只存在本机浏览器，换设备需重新勾选）`, 'ok')
  }

  return (
    <section className="card p-4">
      <h2 className="section-title flex items-center gap-2"><ScanLine size={16} className="text-emerald-600" /> OCR 识题设置</h2>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400">
            <tr><th className="pb-1 pr-3">对比</th><th className="pb-1 pr-3">本地 OCR（绿色扫描线按钮）</th><th className="pb-1">AI OCR（蓝色按钮）</th></tr>
          </thead>
          <tbody className="align-top text-slate-600">
            <tr className="border-t"><td className="py-1.5 pr-3">AI 总开关关闭时</td><td className="py-1.5 pr-3 text-emerald-700 font-medium">照常可用（自动作为唯一 OCR 通道）</td><td className="py-1.5">入口隐藏，服务端拒绝</td></tr>
            <tr className="border-t"><td className="py-1.5 pr-3">图片去哪</td><td className="py-1.5 pr-3">只留在本机浏览器 Worker，不上传</td><td className="py-1.5">经服务端发给 Coding Plan 视觉模型</td></tr>
            <tr className="border-t"><td className="py-1.5 pr-3">费用</td><td className="py-1.5 pr-3 text-emerald-700 font-medium">0 元，零 API 调用</td><td className="py-1.5">受 Coding Plan 配额与限流约束</td></tr>
            <tr className="border-t"><td className="py-1.5 pr-3">公式 / 手写</td><td className="py-1.5 pr-3">只给纯文本，不生成 LaTeX；手写体较弱</td><td className="py-1.5">能理解公式与排版，结果更准</td></tr>
            <tr className="border-t"><td className="py-1.5 pr-3">网络</td><td className="py-1.5 pr-3">首次需下载引擎+语言包，之后可离线</td><td className="py-1.5">每次都要联网</td></tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700">识别语言（中文简体 + 英文默认启用，其他按需下载）</div>
          <span className="badge">当前：{current}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {LOCAL_OCR_LANGS.map((l) => (
            <label key={l.code} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${l.builtin ? 'bg-emerald-50 text-emerald-700' : 'cursor-pointer hover:bg-slate-50'}`}>
              <input type="checkbox" disabled={l.builtin} checked={l.builtin || extra.includes(l.code)} onChange={() => toggle(l.code)} />
              {l.label}{!l.builtin && <span className="text-slate-400">≈{l.approxMB}MB</span>}
            </label>
          ))}
        </div>
        <button className="btn-ghost mt-2 text-xs" onClick={save}><Save size={14} /> 保存语言设置</button>
        <p className="mt-1 text-xs text-slate-400">语言设置只保存在本机浏览器（localStorage），不会写入云端、不跨设备同步；网站的其他设置仍然跨设备同步。</p>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3"><div className="flex items-center gap-1 font-semibold"><HardDriveDownload size={13} /> 首次加载大小</div>
          <p className="mt-1">引擎 {LOCAL_OCR_DOWNLOAD.core}；默认中文+英文语言包 {LOCAL_OCR_DOWNLOAD.defaultLangs}；{LOCAL_OCR_DOWNLOAD.extra}。</p></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="flex items-center gap-1 font-semibold"><WifiOff size={13} /> 缓存与弱网</div>
          <p className="mt-1">{LOCAL_OCR_DOWNLOAD.cache}。{LOCAL_OCR_DOWNLOAD.offline}</p></div>
      </div>
      <p className="mt-2 flex items-start gap-1 text-xs text-amber-700"><ScanText size={13} className="mt-0.5 shrink-0" />
        本地 OCR 只输出纯文本，无法还原 LaTeX 公式；识别不准时可在预览框里直接改字，或开启 AI 总开关后改用 AI OCR。识别失败不会删除原图，也不影响手动录题。
      </p>
      <p className="mt-1 text-xs text-emerald-700 font-medium">本区域不受 AI 总开关控制，也不会产生任何 AI 调用和费用。</p>
    </section>
  )
}
