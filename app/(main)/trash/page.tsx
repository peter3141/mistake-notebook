'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trash2, RotateCcw, ArrowLeft, BookOpen, CalendarDays, ListTodo, StickyNote, Flame, Target, Library, ListTree, FileText } from 'lucide-react'
import { unifiedTrash, restoreTrash, purgeTrash, clearAllTrash } from '@/lib/data-v2'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ImageTrashPanel } from '@/components/ImageTrashPanel'
import { useToast } from '@/components/Toast'
import { TRASH_TYPE_LABEL, type TrashEntityType, type TrashItem } from '@/types'
import { fmtDateTime } from '@/lib/utils'

const ICONS: Record<TrashEntityType, React.ElementType> = {
  mistake: BookOpen, schedule: CalendarDays, task: ListTodo, note: StickyNote, habit: Flame, goal: Target,
  textbook: Library, chapter: ListTree, material: FileText
}

/** v2：统一回收站（错题 / 日程 / 待办 / 笔记 / 习惯 / 目标），30 天内可恢复 */
export default function TrashPage() {
  const [rows, setRows] = useState<TrashItem[]>([])
  const [clearOpen, setClearOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const load = () => void unifiedTrash().then(setRows).catch((e) => toast('回收站加载失败：' + e.message, 'err'))
  useEffect(load, [])

  const restore = async (it: TrashItem) => {
    try { await restoreTrash(it.entity_type, it.entity_id); toast('已恢复', 'ok'); load() }
    catch (e: any) { toast('恢复失败：' + e.message, 'err') }
  }
  const purge = async (it: TrashItem) => {
    const tip = it.entity_type === 'mistake' || it.entity_type === 'note'
      ? `确定彻底删除「${it.title}」吗？该条目关联的云端图片会同时从 Storage 删除，无法恢复。`
      : it.entity_type === 'textbook' || it.entity_type === 'chapter' || it.entity_type === 'material'
        ? `确定彻底删除「${it.title}」吗？其下属章节、知识点/错题关联与课本材料（含 Storage 文件）会一并删除，无法恢复。`
        : `确定彻底删除「${it.title}」吗？无法恢复。`
    if (!window.confirm(tip)) return
    try { await purgeTrash(it.entity_type, it.entity_id); toast('已彻底删除（含云端图片）', 'ok'); load() }
    catch (e: any) { toast('删除失败：' + e.message, 'err') }
  }
  const clear = async () => {
    setBusy(true)
    try { const n = await clearAllTrash(); toast(`已清空 ${n} 条`, 'ok'); load() }
    catch (e: any) { toast('清空失败：' + e.message, 'err') }
    finally { setBusy(false); setClearOpen(false) }
  }

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href="/" className="btn-ghost"><ArrowLeft size={16} /> 返回首页</Link>
        <div className="flex-1"><h1 className="text-xl font-bold text-slate-800">统一回收站</h1><p className="muted">错题、日程、待办、笔记、习惯、目标、课本、章节、课本材料删除后统一保留 30 天，可随时恢复</p></div>
        {rows.length > 0 && <button className="btn-danger" onClick={() => setClearOpen(true)}><Trash2 size={16} /> 清空回收站</button>}
      </div>

      {rows.length === 0 ? <div className="card p-8 text-center text-sm text-slate-500">回收站是空的 🎉</div> : (
        <div className="space-y-2">
          {rows.map((it) => {
            const Icon = ICONS[it.entity_type] || Trash2
            return (
              <div key={it.id} className="card flex flex-wrap items-center gap-3 p-3">
                <Icon size={17} className="text-slate-400" />
                <div className="flex-1">
                  <div className="truncate text-sm font-medium text-slate-700">{it.title}</div>
                  <div className="text-xs text-slate-400">
                    <span className="badge mr-2">{TRASH_TYPE_LABEL[it.entity_type]}</span>
                    删除于 {fmtDateTime(it.deleted_at)} · {fmtDateTime(it.expires_at)} 后自动清除
                  </div>
                </div>
                <button className="btn-ghost" onClick={() => restore(it)}><RotateCcw size={15} /> 恢复</button>
                <button className="btn-ghost text-rose-600" onClick={() => purge(it)}><Trash2 size={15} /> 彻底删除</button>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={clearOpen} title="确定清空回收站？" busy={busy}
        description={`将永久删除 ${rows.length} 条数据（含错题、日程、待办、笔记、习惯、目标），并同时删除这些错题/笔记在 Supabase Storage 中的图片文件，无法恢复。建议先在「设置」导出一次 JSON 全量备份与原图包。`}
        confirmText="永久清空" requireText="清空" onConfirm={clear} onClose={() => setClearOpen(false)} />

      <ImageTrashPanel />
    </div>
  )
}
