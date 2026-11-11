'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, ShieldCheck, Download, Upload, LogOut, RotateCcw, Printer, Trash2, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAi } from '@/components/AiProvider'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { db, listPrintTemplates, deletePrintTemplate, savePrintTemplate, listShares, revokeShare } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_PRINT_OPTIONS, type PrintTemplate, type UserSettings } from '@/types'
import { DEFAULT_REVIEW_INTERVALS } from '@/lib/ai/defaults'
import { LocalOcrSettings } from '@/components/LocalOcrSettings'
import { OriginalPackageButton } from '@/components/export/OriginalPackageButton'
import { downloadBlob, toDateInput } from '@/lib/utils'

const CAPS: { key: keyof UserSettings; label: string; desc: string }[] = [
  { key: 'ai_organize', label: 'AI整理错题', desc: '对应 /api/ai/organize，结果先预览再确认应用' },
  { key: 'ai_ocr', label: 'OCR / 图片识题', desc: '对应 /api/ai/ocr，识别结果先预览再填入' },
  { key: 'ai_similar', label: '相似题推荐', desc: '对应 /api/ai/similar，结果标注「AI生成，需核对」' },
  { key: 'ai_batch', label: 'AI批量整理', desc: '列表页批量选中后一次整理多题，执行前显示预计调用次数' },
  { key: 'ai_schedule_parse', label: 'AI自然语言创建日程', desc: '/api/ai/schedule-parse：输入一句话先预览，确认后才创建日程' },
  { key: 'ai_note_summary', label: 'AI笔记总结', desc: '/api/ai/note-summary：总结结果先预览，确认后才写入笔记' },
  { key: 'ai_plan', label: 'AI规划（预留）', desc: '预留能力，默认关闭；不会产生任何调用' },
  { key: 'ai_textbook_quiz', label: '课本AI补充出题（v5）', desc: '/api/ai/textbook-quiz：仅在章节有课本材料或摘要时可用；AI 题默认不打印、不进错题库' }
]

export default function SettingsPage() {
  const ai = useAi()
  const toast = useToast()
  const router = useRouter()
  const [s, setS] = useState<UserSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState<PrintTemplate[]>([])
  const [tplName, setTplName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [catalog, setCatalog] = useState<{ subjects: any[]; books: any[] }>({ subjects: [], books: [] })
  const [shares, setShares] = useState<any[]>([])

  const load = async () => {
    const r = await fetch('/api/settings', { cache: 'no-store' })
    if (r.ok) setS(await r.json())
    setTemplates(await listPrintTemplates())
    setShares(await listShares())
    const [sj, bk] = await Promise.all([
      db().from('subjects').select('*').order('sort_order'),
      db().from('mistake_books').select('*').order('created_at')
    ])
    setCatalog({ subjects: sj.data || [], books: bk.data || [] })
  }
  useEffect(() => { void load() }, [])

  const patch = async (v: Record<string, unknown>) => {
    setSaving(true)
    try {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '保存失败')
      setS(j)
      await ai.refresh()   // 立刻刷新全站 AI 入口状态，无需重新部署
      toast('设置已保存，所有设备同步生效', 'ok')
    } catch (e: any) { toast('保存失败：' + e.message, 'err') }
    finally { setSaving(false) }
  }

  const exportData = async (format: 'json' | 'csv') => {
    setBusy(format)
    try {
      const r = await fetch(`/api/backup/export?format=${format}`)
      if (!r.ok) throw new Error((await r.json()).error || '导出失败')
      if (format === 'json') {
        const j = await r.json()
        downloadBlob(`个人综合管理备份-${toDateInput(new Date())}.json`, JSON.stringify(j, null, 2))
      } else {
        downloadBlob(`错题清单-${toDateInput(new Date())}.csv`, await r.text(), 'text/csv')
      }
      toast('备份文件已下载（JSON 为全模块全量备份），请另存到网盘或U盘', 'ok')
    } catch (e: any) { toast('导出失败：' + e.message, 'err') }
    finally { setBusy('') }
  }

  const previewImport = async () => {
    try {
      const data = JSON.parse(importText)
      const r = await fetch('/api/backup/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, data })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '预览失败')
      setImportPreview(j)
      const mods = j.modules ? Object.entries(j.modules).map(([k, v]) => `${k} ${v}`).join('、') : `错题 ${j.count}`
      toast(`预览完成：${mods}`, 'ok')
    } catch (e: any) { toast('解析失败：' + e.message, 'err') }
  }

  const doImport = async () => {
    try {
      const data = JSON.parse(importText)
      const r = await fetch('/api/backup/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: false, data })
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '导入失败')
      toast(`已导入 ${j.count} 道错题`, 'ok'); setImportPreview(null); setImportText('')
    } catch (e: any) { toast('导入失败：' + e.message, 'err') }
  }

  const deleteAll = async () => {
    const { error } = await db().rpc('delete_my_data')
    if (error) { toast('注销失败：' + error.message, 'err'); return }
    toast('所有错题数据已清空', 'ok')
    await createClient().auth.signOut()
    router.push('/login')
  }

  const signOut = async () => { await createClient().auth.signOut(); router.push('/login') }

  const statusColor = ai.status?.statusText === '已开启' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : ai.status?.statusText === 'AI未配置' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200'

  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold text-slate-800">设置</h1><p className="muted">AI 开关、打印模板、备份与账号安全</p></div>

      {/* ============ AI 功能开关（验收 16-22） ============ */}
      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="section-title flex items-center gap-2"><Sparkles size={17} className="text-brand-600" /> AI 功能</h2>
          <span className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${statusColor}`}>
            AI功能当前状态：{ai.loading ? '检测中…' : ai.status?.statusText || '已关闭'}
          </span>
          {/* v5：课本 AI 出题的独立状态（AI未配置 / 已关闭 / 已开启） */}
          <span className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
            ai.status?.statusText === 'AI未配置' ? 'bg-amber-50 text-amber-700 border-amber-200'
              : ai.can('textbook_quiz') ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            课本AI出题：{ai.loading ? '检测中…'
              : ai.status?.statusText === 'AI未配置' ? 'AI未配置'
                : ai.can('textbook_quiz') ? '已开启' : '已关闭'}
          </span>
          {saving && <Loader2 size={15} className="animate-spin text-brand-600" />}
        </div>

        {/* 总开关 */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
          <div>
            <div className="font-semibold text-slate-800">启用AI功能（总开关）</div>
            <div className="muted mt-0.5">关闭后：所有 AI 入口隐藏/置灰，服务端 /api/ai/* 直接拒绝请求，<b>不产生任何 AI 调用和费用</b>。</div>
          </div>
          <Toggle checked={!!s?.ai_enabled} disabled={saving || !s} onChange={(v) => patch({ ai_enabled: v })} label="AI 总开关" />
        </div>

        {/* 未配置提示 */}
        {ai.status && !ai.status.configured && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> AI未配置（AI 入口已自动禁用，其他功能不受影响）</div>
            <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed">
              {ai.status.configIssues.map((i) => <li key={i}>{i}</li>)}
            </ul>
            <p className="mt-2 text-xs">补配方法：在 Vercel → Settings → Environment Variables 填 <code>DASHSCOPE_CODING_API_KEY</code>（sk-sp- 开头）与 <code>AI_BASE_URL</code>（https://coding.dashscope.aliyuncs.com/v1），重新部署后回来打开总开关。详见《使用与维护手册》第 3 部分。</p>
          </div>
        )}

        {/* 子开关 */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">子功能开关</h3>
            <button className="btn-ghost text-xs" onClick={() => patch({ reset: true })}><RotateCcw size={14} /> 恢复默认</button>
          </div>
          {CAPS.map((c) => (
            <div key={c.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${!s?.ai_enabled ? 'border-slate-100 bg-slate-50 opacity-55' : 'border-slate-200'}`}>
              <div><div className="text-sm font-medium text-slate-700">{c.label}</div><div className="text-xs text-slate-400">{c.desc}</div></div>
              <Toggle checked={!!s?.[c.key] && !!s?.ai_enabled} disabled={!s || !s.ai_enabled || saving}
                onChange={(v) => patch({ [c.key]: v })} label={c.label} />
            </div>
          ))}
          {!s?.ai_enabled && <p className="text-xs text-slate-400">总开关已关闭 → 以上 {CAPS.length} 个子开关自动全部失效；日程、待办、笔记、习惯、番茄钟、目标、手动组卷、打印、导出、统计等所有非 AI 功能照常可用。</p>}
        </div>

        {/* 状态与模型 */}
        <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
          <div>文本模型（AI_MODEL）：<b>{ai.status?.textModel || '—'}</b></div>
          <div>视觉模型（VISION_MODEL）：<b>{ai.status?.visionModel || '—'}</b></div>
          <div>OCR 模型（OCR_MODEL）：<b>{ai.status?.ocrModel || '—'}</b></div>
          <div>Base URL：<b className="break-all">{ai.status?.baseUrl || '—'}</b></div>
          <div>累计成功调用：<b>{ai.status?.usage.calls ?? 0} 次 / {ai.status?.usage.units ?? 0} 配额单位</b></div>
          <div>服务端配置：<b>{ai.status?.configured ? '已配置' : '未配置'}</b>（密钥不会显示在这里）</div>
        </div>
        <p className="mt-2 text-xs text-slate-400">说明：API Key 只保存在服务端环境变量，本页面、前端代码和日志都不会显示它。关闭总开关后即使有人直接调用 /api/ai/*，也会收到「AI功能已关闭」。</p>
      </section>

      <LocalOcrSettings />

      {/* ============ 复习与提示词 ============ */}
      <section className="card p-4">
        <h2 className="section-title">复习与 AI 提示词</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">艾宾浩斯复习间隔（天，逗号分隔）</label>
            <input className="input" defaultValue={(s?.review_intervals || DEFAULT_REVIEW_INTERVALS).join(',')}
              key={(s?.review_intervals || []).join(',')} onBlur={(e) => {
                const arr = e.target.value.split(/[,，]/).map((x) => Number(x.trim())).filter((n) => n > 0 && n < 366)
                if (arr.length) void patch({ review_intervals: arr })
              }} />
          </div>
          <div>
            <label className="label">备份提醒周期（天）</label>
            <input className="input" type="number" min={1} max={365} defaultValue={s?.backup_reminder_days || 30}
              key={s?.backup_reminder_days} onBlur={(e) => void patch({ backup_reminder_days: Number(e.target.value) || 30 })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">自定义 AI 整理提示词模板</label>
            <textarea className="input min-h-[90px]" defaultValue={s?.prompt_template || ''} key={s?.prompt_template}
              onBlur={(e) => void patch({ prompt_template: e.target.value })} />
            <p className="mt-1 text-xs text-slate-400">失焦自动保存。只影响 AI 整理结果，不改动原题库。</p>
          </div>
        </div>
      </section>

      {/* ============ v2：日程提醒 / 番茄钟 / 默认视图 ============ */}
      <section className="card p-4">
        <h2 className="section-title">日程提醒与专注设置（v2 新增）</h2>
        <p className="muted mt-1">这些设置和 AI 开关一样存在云端，换设备自动同步；全部为非 AI 功能，关闭 AI 后仍然可用。</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><div className="text-sm font-medium text-slate-700">启用日程提醒</div><div className="text-xs text-slate-400">日程开始前在站内显示提醒条</div></div>
            <Toggle checked={!!s?.reminder_enabled} disabled={!s || saving} onChange={(v) => patch({ reminder_enabled: v })} label="日程提醒" />
          </div>
          <div>
            <label className="label">日程默认视图</label>
            <select className="input" value={s?.default_calendar_view || 'month'}
              onChange={(e) => patch({ default_calendar_view: e.target.value })}>
              <option value="day">日视图</option><option value="week">周视图</option><option value="month">月视图</option>
            </select>
          </div>
          <div>
            <label className="label">新建日程默认提前提醒（分钟）</label>
            <input className="input" type="number" min={0} max={1440} defaultValue={s?.default_remind_minutes ?? 15}
              key={s?.default_remind_minutes} onBlur={(e) => void patch({ default_remind_minutes: Number(e.target.value) || 0 })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">专注时长（分钟）</label>
              <input className="input" type="number" min={1} max={180} defaultValue={s?.focus_minutes || 25}
                key={s?.focus_minutes} onBlur={(e) => void patch({ focus_minutes: Number(e.target.value) || 25 })} /></div>
            <div><label className="label">休息时长（分钟）</label>
              <input className="input" type="number" min={1} max={60} defaultValue={s?.break_minutes || 5}
                key={s?.break_minutes} onBlur={(e) => void patch({ break_minutes: Number(e.target.value) || 5 })} /></div>
          </div>
        </div>
      </section>

      {/* ============ v2：分享管理 ============ */}
      <section className="card p-4">
        <h2 className="section-title">分享管理（v2 新增）</h2>
        <p className="muted mt-1">这里能看到全部只读分享链接（错题 / 笔记 / 日程），可随时取消，取消后链接立即失效。</p>
        <div className="mt-3 space-y-2">
          {shares.length === 0 && <p className="text-xs text-slate-400">还没有创建过分享链接。可在错题列表或笔记页生成。</p>}
          {shares.map((sh) => {
            const expired = new Date(sh.expires_at) < new Date()
            return (
              <div key={sh.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="badge">{sh.scope}</span>
                <span className="flex-1 truncate text-slate-600">/share/{sh.token}</span>
                <span className="text-xs text-slate-400">过期：{new Date(sh.expires_at).toLocaleDateString('zh-CN')} · 浏览 {sh.view_count || 0} 次</span>
                {(sh.revoked || expired) ? <span className="badge bg-slate-100 text-slate-400">{sh.revoked ? '已取消' : '已过期'}</span>
                  : <button className="btn-ghost py-1 text-xs text-rose-600" onClick={async () => { await revokeShare(sh.id); setShares(await listShares()); toast('分享已取消', 'ok') }}>取消分享</button>}
              </div>
            )
          })}
        </div>
      </section>

      {/* ============ 科目与错题本归档 ============ */}
      <section className="card p-4">
        <h2 className="section-title">科目与错题本（切换 / 归档）</h2>
        <p className="muted mt-1">归档后不再出现在新建页的下拉框里，但历史错题仍然保留、可筛选。新建请在「新建错题」页点「+ 新科目 / + 新错题本」。</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {(['subjects', 'books'] as const).map((kind) => (
            <div key={kind}>
              <h3 className="mb-2 text-sm font-medium text-slate-600">{kind === 'subjects' ? '科目' : '错题本'}</h3>
              <ul className="divide-y rounded-lg border border-slate-100 text-sm">
                {(catalog[kind] || []).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className={x.archived ? 'text-slate-400 line-through' : 'text-slate-700'}>{x.name}</span>
                    <button className="btn-ghost py-1 text-xs" onClick={async () => {
                      await db().from(kind === 'subjects' ? 'subjects' : 'mistake_books')
                        .update({ archived: !x.archived }).eq('id', x.id)
                      toast(x.archived ? '已取消归档' : '已归档', 'ok'); void load()
                    }}>{x.archived ? '取消归档' : '归档'}</button>
                  </li>
                ))}
                {!(catalog[kind] || []).length && <li className="px-3 py-2 text-xs text-slate-400">暂无</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ============ 打印模板 ============ */}
      <section className="card p-4">
        <h2 className="section-title flex items-center gap-2"><Printer size={16} /> 打印模板</h2>
        <p className="muted mt-1">在打印页调好选项后，可保存为模板反复使用；也可在这里删除。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="模板名称，如：周末复习卷" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <button className="btn-ghost" onClick={async () => {
            if (!tplName.trim()) return toast('请先填模板名称', 'err')
            await savePrintTemplate({ name: tplName.trim(), variant: 'student', options: DEFAULT_PRINT_OPTIONS, is_default: false })
            setTplName(''); toast('模板已保存', 'ok'); setTemplates(await listPrintTemplates())
          }}>保存当前默认配置为新模板</button>
        </div>
        {templates.length > 0 && <ul className="mt-3 divide-y text-sm">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <span>{t.name} <span className="badge ml-1">{t.variant}</span></span>
              <button className="btn-ghost text-rose-600" onClick={async () => { await deletePrintTemplate(t.id); setTemplates(await listPrintTemplates()) }}><Trash2 size={14} /> 删除</button>
            </li>
          ))}
        </ul>}
      </section>

      {/* ============ 备份 ============ */}
      <section className="card p-4">
        <h2 className="section-title flex items-center gap-2"><ShieldCheck size={16} /> 备份与恢复</h2>
        <p className="muted mt-1">Supabase 免费版不含自动备份，建议每月导出一次并存到网盘。</p>
        <div className="no-print mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy === 'json'} onClick={() => exportData('json')}>{busy === 'json' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} 导出 JSON 全量备份</button>
          <button className="btn-ghost" disabled={busy === 'csv'} onClick={() => exportData('csv')}><Download size={15} /> 导出 CSV</button>
        </div>
        {/* v4：本地原图备份（可选辅助，网页不依赖它） */}
        <div className="no-print mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <h3 className="text-sm font-semibold text-emerald-900">本地原图备份（可选，不是主方案）</h3>
          <p className="muted mt-1">JSON 备份只含图片路径，不含图片本体。想把图片也存一份到自己的电脑/网盘，用下面的「导出原图包」。</p>
          <div className="mt-2"><OriginalPackageButton /></div>
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <label className="label">恢复备份：粘贴 JSON 备份内容，先预览字段映射再导入（不会覆盖已有数据，按新 id 追加）</label>
          <textarea className="input min-h-[100px] font-mono text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"version":1,"mistakes":[...]}' />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={previewImport}><Upload size={15} /> 预览 / 字段映射</button>
            {importPreview && <button className="btn-primary" onClick={doImport}><CheckCircle2 size={15} /> 确认导入（按新 id 追加）</button>}
          </div>
          {importPreview && (
            <div className="mt-3 rounded-lg bg-white p-3 text-xs">
              <b>字段映射预览：</b>
              <ul className="mt-1 list-disc pl-5">{Object.entries(importPreview.mapping || {}).map(([k, v]) => <li key={k}>{k} → {String(v)}</li>)}</ul>
              {importPreview.modules && <p className="mt-1 text-slate-600">各模块条数：{Object.entries(importPreview.modules).map(([k, v]) => `${k} ${v}`).join('、')}</p>}
              <p className="mt-2 text-slate-500">示例：{importPreview.sample}</p>
            </div>
          )}
        </div>
      </section>

      {/* ============ 账号安全 ============ */}
      <section className="card p-4">
        <h2 className="section-title">账号安全</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={signOut}><LogOut size={15} /> 退出登录</button>
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> 注销并删除我的全部数据</button>
        </div>
        <p className="mt-2 text-xs text-slate-400">注销会清空所有错题、图片记录、复习日志与分享链接，不可恢复；建议先导出 JSON 备份。</p>
      </section>

      <ConfirmDialog open={confirmDelete} title="注销并删除全部数据？" requireText="注销" busy={false}
        description="这会永久删除你的全部错题、复习记录、打印模板与分享链接，无法恢复。请先导出一次 JSON 备份。"
        confirmText="永久删除" onConfirm={deleteAll} onClose={() => setConfirmDelete(false)} />
    </div>
  )
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-label={label} aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}
