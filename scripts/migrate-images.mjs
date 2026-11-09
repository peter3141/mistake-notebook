#!/usr/bin/env node
/**
 * 图片架构 v4 · 历史数据迁移脚本（幂等，可重复执行，失败可重跑）
 *
 * 处理两类历史数据：
 *   A) 图片表里残留的 Base64 / 二进制列 → 读出 → 上传 Storage → 写回 storage_path → 清空旧列
 *   B) 富文本（mistakes.content/answer/analysis、notes.content）里内嵌的
 *      <img src="data:image/...;base64,...."> → 上传 Storage → 改成 <img data-storage-path="...">
 *
 * ★ 数据库最终只留路径与元数据，绝不存图片数据。
 * ★ 迁移前请先备份数据库（Supabase → Database → Backups，或设置页导出 JSON + 原图包）。
 * ★ 脚本只在你的本机运行一次，需要 service_role key；绝不要把它填到 Vercel 前端环境变量里。
 *
 * 用法（Windows PowerShell / macOS 终端相同）：
 *   node scripts/migrate-images.mjs --dry-run          # 只统计，不写任何数据
 *   node scripts/migrate-images.mjs                   # 真正迁移
 *   node scripts/migrate-images.mjs --limit=200       # 限制扫描条数，分批跑
 *
 * 环境变量（可放 .env.local，脚本会自己读；.env.local 已在 .gitignore 中）：
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key，仅本地一次性使用>
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = join(ROOT, 'scripts', 'migration-report.json')
const BUCKET = 'mistake-images'
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 1000

// ---- 读取 .env.local（不覆盖已有 process.env） ----
try {
  const envPath = join(ROOT, '.env.local')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch { /* 忽略：环境变量可直接由 shell 提供 */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('❌ 缺少环境变量。请在 .env.local 里填：')
  console.error('   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co')
  console.error('   SUPABASE_SERVICE_ROLE_KEY=<Supabase → Settings → API → service_role key>')
  console.error('   ⚠️ service_role 只在本地这次迁移使用，绝对不要填到 Vercel 的公开变量或前端代码。')
  process.exit(1)
}
if (!key.startsWith('eyJ') && !key.startsWith('sb_secret')) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 看起来不对（应为 eyJ... 或 sb_secret... 开头的 service_role key）。')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const stat = { scannedTables: 0, tableRows: 0, scannedHtml: 0, htmlImages: 0, migrated: 0, skipped: 0, failed: [], manual: [] }
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8') || '{}') : { done: [] }
const done = new Set(report.done || [])
const isDone = (k) => done.has(k)
const markDone = (k) => { done.add(k) }

function extOf(mime) {
  const e = (mime || '').toLowerCase().replace('image/', '').replace('jpeg', 'jpg')
  return ['png', 'jpg', 'webp', 'gif'].includes(e) ? e : 'webp'
}
function mimeOf(ext) { return ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }

async function uploadBuffer(buf, uid, entityId, ext, mime) {
  const path = `${uid}/mistakes/inline/${entityId}/${randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

// ---------------------------------------------------------------------------
// A) 检测并迁移图片表里的历史 Base64 / 二进制列
// ---------------------------------------------------------------------------
const SUSPECT = ['base64', 'data_url', 'image_data', 'image_base64', 'blob_data', 'content_base64', 'binary_data', 'file_data', 'raw_bytes', 'data', 'bytes']
async function migrateTableBase64(table) {
  const { data: sample, error } = await supabase.from(table).select('*').limit(1)
  if (error) { stat.failed.push(`${table}: 读取失败 ${error.message}`); return }
  if (!sample?.length) return
  const cols = Object.keys(sample[0]).filter((c) => SUSPECT.includes(c.toLowerCase()))
  if (!cols.length) return
  stat.scannedTables++
  console.log(`⚠️  ${table} 发现历史字段：${cols.join(', ')}`)

  const { data: rows, error: e2 } = await supabase.from(table).select('*').not(cols[0], 'is', null).limit(LIMIT)
  if (e2) { stat.failed.push(`${table}: 查询失败 ${e2.message}`); return }
  for (const row of rows || []) {
    stat.tableRows++
    const col = cols.find((c) => row[c] != null && String(row[c]).length > 0)
    if (!col) { stat.skipped++; continue }
    const keyHash = `table:${table}:${row.id}:${col}`
    if (isDone(keyHash)) { stat.skipped++; continue }
    const raw = String(row[col])
    const m = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s)
    let ext = 'webp', b64 = raw
    if (m) { ext = extOf(m[1]); b64 = m[2] }
    let buf
    try { buf = Buffer.from(b64, 'base64') } catch { stat.manual.push(`${table}/${row.id}/${col}: Base64 解码失败，需手动处理`); continue }
    if (!buf.byteLength || buf.byteLength > 8 * 1024 * 1024) {
      stat.manual.push(`${table}/${row.id}/${col}: 数据为空或 >8MB，需手动处理`)
      continue
    }
    if (DRY) { stat.migrated++; continue }
    try {
      const uid = row.user_id
      const entityId = row.mistake_id || row.entity_id || row.id
      const path = await uploadBuffer(buf, uid, entityId, ext, mimeOf(ext))
      const patch = { storage_path: path, size_bytes: buf.byteLength, compressed_size_bytes: buf.byteLength }
      patch[col] = null
      // 清掉其余残留列（如果存在）
      for (const c of cols) if (c !== col) patch[c] = null
      const { error: upErr } = await supabase.from(table).update(patch).eq('id', row.id)
      if (upErr) throw new Error(upErr.message)
      if (table === 'mistake_images') {
        await supabase.from(table).update({ image_role: row.image_role || 'inline', created_by: 'migration' }).eq('id', row.id)
      }
      markDone(keyHash); stat.migrated++
    } catch (e) { stat.failed.push(`${table}/${row.id}: ${e.message}`) }
  }
}

// ---------------------------------------------------------------------------
// B) 富文本里内嵌的 Base64 图片
// ---------------------------------------------------------------------------
const IMG_RE = /<img\b[^>]*\bsrc\s*=\s*["']data:image\/([a-zA-Z0-9.+-]+);base64,([^"']+)["'][^>]*>/gi
async function migrateHtmlField(table, idField, field) {
  let from = 0
  const PAGE = 100
  while (from < LIMIT) {
    const { data: rows, error } = await supabase.from(table)
      .select(`id,user_id,${field}`).range(from, from + PAGE - 1)
    if (error) { stat.failed.push(`${table}.${field}: ${error.message}`); break }
    if (!rows?.length) break
    from += rows.length
    for (const row of rows) {
      if (!row[field]) continue
      stat.scannedHtml++
      const matches = [...String(row[field]).matchAll(IMG_RE)]
      if (!matches.length) continue
      stat.htmlImages += matches.length
      let html = String(row[field])
      let changed = false
      for (const match of matches) {
        const ext = extOf(match[1])
        const b64 = match[2]
        const keyHash = `html:${table}:${row.id}:${field}:${b64.length}:${b64.slice(-64)}`
        if (isDone(keyHash)) { stat.skipped++; continue }
        let buf
        try { buf = Buffer.from(b64, 'base64') } catch { stat.manual.push(`${table}/${row.id}/${field}: Base64 解码失败`); continue }
        if (!buf.byteLength || buf.byteLength > 6 * 1024 * 1024) {
          stat.manual.push(`${table}/${row.id}/${field}: 单图为空或 >6MB，需手动重新上传`)
          continue
        }
        if (DRY) { stat.migrated++; continue }
        try {
          const path = await uploadBuffer(buf, row.user_id, row[idField] || row.id, ext, mimeOf(ext))
          if (table === 'mistakes') {
            await supabase.from('mistake_images').insert({
              user_id: row.user_id, mistake_id: row.id, storage_path: path,
              mime_type: mimeOf(ext), size_bytes: buf.byteLength,
              compressed_size_bytes: buf.byteLength, image_role: 'inline', created_by: 'migration'
            })
          } else {
            await supabase.from('attachments').insert({
              user_id: row.user_id, entity_type: 'note', entity_id: row.id,
              storage_path: path, mime_type: mimeOf(ext), size_bytes: buf.byteLength,
              image_role: 'inline'
            })
          }
          html = html.replace(match[0], `<img data-storage-path="${path}" alt="迁移图片">`)
          markDone(keyHash); stat.migrated++; changed = true
        } catch (e) { stat.failed.push(`${table}/${row.id}: ${e.message}`) }
      }
      if (changed && !DRY) {
        const { error: upErr } = await supabase.from(table).update({ [field]: html }).eq('id', row.id)
        if (upErr) stat.failed.push(`${table}/${row.id}: 写回失败 ${upErr.message}（图片已在云端）`)
      }
    }
    if (rows.length < PAGE) break
  }
}

console.log(`\n=== 图片架构 v4 迁移 ${DRY ? '（DRY RUN，只统计不写入）' : ''} ===`)
console.log('⚠️  迁移前请确认已在 Supabase → Database → Backups 做过备份。\n')

await migrateTableBase64('mistake_images')
await migrateTableBase64('attachments')
await migrateHtmlField('mistakes', 'id', 'content')
await migrateHtmlField('mistakes', 'id', 'answer')
await migrateHtmlField('mistakes', 'id', 'analysis')
await migrateHtmlField('notes', 'id', 'content')

if (!DRY) {
  writeFileSync(REPORT, JSON.stringify({ updatedAt: new Date().toISOString(), done: [...done].slice(-20000) }, null, 2))
}

console.log('\n=== 结果 ===')
console.log(`扫描富文本行：${stat.scannedHtml}；发现内嵌 Base64 图片：${stat.htmlImages}`)
console.log(`图片表历史字段表数：${stat.scannedTables}；扫描行：${stat.tableRows}`)
console.log(`${DRY ? '预计迁移' : '已迁移'}：${stat.migrated}；跳过（已迁移/幂等）：${stat.skipped}；失败：${stat.failed.length}；需手动处理：${stat.manual.length}`)
if (stat.failed.length) console.log('\n失败清单（修好后直接重跑本脚本即可）：\n' + stat.failed.slice(0, 30).map((s) => ' - ' + s).join('\n'))
if (stat.manual.length) {
  console.log('\n★ 无法自动迁移，需手动处理的清单：\n' + stat.manual.slice(0, 50).map((s) => ' - ' + s).join('\n'))
  console.log('   手动最小步骤：在对应错题/笔记里删掉这张旧图 → 重新用「拍照/上传整题」或「插入图片」上传 → 核对后保存。')
}
console.log('\n迁移后可重复执行本脚本验证（幂等：第二次应输出 已迁移 0、跳过数增加）。')
console.log('下一步：node scripts/verify-migration.mjs 抽查 5 张图 + 3 道整题错题。\n')
