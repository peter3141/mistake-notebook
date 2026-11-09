'use client'

import { useEffect, useState } from 'react'
import { HardDrive, RotateCcw, Trash2, Loader2, ShieldCheck } from 'lucide-react'
import { db, listDeletedImages, restoreDeletedImage, purgeDeletedImage } from '@/lib/data'
import { ConfirmDialog } from './ConfirmDialog'
import { useToast } from './Toast'
import { fmtDateTime } from '@/lib/utils'

const ROLE_LABEL: Record<string, string> = {
  original: '整题原图', cropped: '裁剪图', inline: '普通插图', thumbnail: '缩略图'
}

interface Orphan { storage_path: string; size_bytes: number; created_at: string; reason: string }

/**
 * v4 图片回收站 + 孤儿文件清理
 *  - 删图只登记，Storage 文件保留；这里「彻底删除」才会 storage.remove()
 *  - 孤儿清单只读列出，必须用户勾选 + 二次确认才删，绝不自动无提示删除
 *  - 已进图片回收站 / 被富文本引用的文件不会出现在孤儿清单里（SQL 已排除）
 */
export function ImageTrashPanel() {
  const toast = useToast()
  const [tab, setTab] = useState<'images' | 'orphans'>('images')
  const [deleted, setDeleted] = useState<any[]>([])
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState<any | null>(null)
  const [confirmOrphans, setConfirmOrphans] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setDeleted(await listDeletedImages()) }
    catch (e: any) { toast('图片回收站加载失败：' + e.message, 'err') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const scanOrphans = async () => {
    setLoading(true)
    try {
      const { data, error } = await db().rpc('list_orphan_images_v4', { p_limit: 200 })
      if (error) throw error
      setOrphans((data || []) as Orphan[])
      setChecked([])
      toast(`扫描完成：发现 ${(data || []).length} 个未被数据库引用的文件（仅列出，未删除任何文件）`, 'ok')
    } catch (e: any) { toast('扫描失败：' + e.message, 'err') }
    finally { setLoading(false) }
  }

  const doPurge = async () => {
    if (!confirmPurge) return
    setBusy(true)
    try { await purgeDeletedImage(confirmPurge.id); toast('图片已从 Storage 彻底删除', 'ok'); setConfirmPurge(null); void load() }
    catch (e: any) { toast('删除失败：' + e.message, 'err') }
    finally { setBusy(false) }
  }

  const doCleanOrphans = async () => {
    setBusy(true)
    try {
      const { error } = await db().storage.from('mistake-images').remove(checked)
      if (error) throw error
      toast(`已清理 ${checked.length} 个孤儿文件`, 'ok')
      setChecked([]); setConfirmOrphans(false); void scanOrphans()
    } catch (e: any) { toast(`清理失败：${e.message}（文件仍在，可重试）`, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="card mt-6 p-4">
      <h2 className="section-title flex items-center gap-2"><HardDrive size={17} /> 图片回收站与孤儿文件清理</h2>
      <p className="muted mt-1">
        删除图片或错题时，<b>云端 Storage 文件不会立即删除</b>（30 天内可恢复）；只有「彻底删除 / 清空回收站」才会真正清掉文件。
        孤儿文件 = 上传成功后数据库没有登记的文件（例如放弃保存的整题图），<b>只列出、勾选确认后才删除</b>。
      </p>

      <div className="mt-3 flex gap-2">
        <button className={tab === 'images' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('images')}>图片回收站（{deleted.length}）</button>
        <button className={tab === 'orphans' ? 'btn-primary' : 'btn-ghost'} onClick={() => { setTab('orphans'); void scanOrphans() }}>孤儿文件扫描</button>
        {loading && <Loader2 size={16} className="animate-spin text-brand-600" />}
      </div>

      {tab === 'images' && (
        <div className="mt-3 space-y-2">
          {deleted.length === 0 && <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">没有被删除的图片</div>}
          {deleted.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <span className="badge bg-slate-100">{ROLE_LABEL[d.image_role] || d.image_role}</span>
              <span className="flex-1 truncate font-mono text-xs text-slate-500">{d.storage_path}</span>
              <span className="muted text-xs">{fmtDateTime(d.deleted_at)}</span>
              <button className="btn-ghost" onClick={async () => {
                try { await restoreDeletedImage(d.id); toast('图片已恢复', 'ok'); void load() }
                catch (e: any) { toast('恢复失败：' + e.message, 'err') }
              }}><RotateCcw size={14} /> 恢复</button>
              <button className="btn-ghost text-rose-600" onClick={() => setConfirmPurge(d)}><Trash2 size={14} /> 彻底删除</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'orphans' && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <ShieldCheck size={14} className="text-emerald-600" />
            已排除：图片登记表、图片回收站、错题/笔记富文本中仍被引用的图片 —— 不会误删。
          </div>
          {orphans.length === 0 && <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">未发现孤儿文件，或请点上方「孤儿文件扫描」重新扫描</div>}
          {orphans.map((o) => (
            <label key={o.storage_path} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-xs">
              <input type="checkbox" checked={checked.includes(o.storage_path)} onChange={(e) =>
                setChecked((c) => e.target.checked ? [...c, o.storage_path] : c.filter((x) => x !== o.storage_path))} />
              <span className="flex-1 break-all font-mono">{o.storage_path}</span>
              <span className="text-slate-400">{(Number(o.size_bytes) / 1024).toFixed(0)} KB</span>
            </label>
          ))}
          {orphans.length > 0 && (
            <button className="btn-danger" disabled={!checked.length || busy} onClick={() => setConfirmOrphans(true)}>
              <Trash2 size={15} /> 清理选中的 {checked.length} 个文件
            </button>
          )}
        </div>
      )}

      <ConfirmDialog open={!!confirmPurge} busy={busy} title="彻底删除这张图片？"
        description="会同时删除 Supabase Storage 中的文件，无法恢复。若该原图有裁剪图，裁剪图仍会保留。"
        confirmText="彻底删除" onConfirm={doPurge} onClose={() => setConfirmPurge(null)} />
      <ConfirmDialog open={confirmOrphans} busy={busy} title={`确定清理 ${checked.length} 个孤儿文件？`}
        description={`将永久删除这些 Storage 文件，无法恢复。已核对：它们未被数据库登记、未被富文本引用、也不在图片回收站中。建议先导出一次 JSON 全量备份。`}
        confirmText="确认清理" requireText="清理" onConfirm={doCleanOrphans} onClose={() => setConfirmOrphans(false)} />
    </div>
  )
}
