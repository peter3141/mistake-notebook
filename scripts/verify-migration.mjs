#!/usr/bin/env node
/**
 * 迁移后验证（需要真实 Supabase 凭据；无凭据时请改用 verify-image-arch.mjs 做离线自检）
 *
 * 按需求抽查：
 *   · 随机 5 张图 → 确认列表 / 详情 / 打印 / 分享页取图所依赖的「签名 URL + 文件可下载」都正常
 *   · 随机 3 道带整题原图的错题 → 确认原图与 OCR 文字都能正常展示
 *   · 富文本里不再有 data:image Base64
 *   · 图片表没有 Base64 / 二进制列
 *
 * 用法：node scripts/verify-migration.mjs
 * 环境变量：NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY（或直接在 shell 里 export）
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  const envPath = join(ROOT, '.env.local')
  if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.log('⚠️  未配置 Supabase 凭据 → 本脚本无法做真实抽查（这是预期的，未真实联调时不要声称通过）。')
  console.log('   请填 .env.local 的 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 后重跑。')
  console.log('   不依赖凭据的离线自检请跑：node scripts/verify-image-arch.mjs')
  process.exit(2)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const BUCKET = 'mistake-images'
const SUSPECT = /base64|blob|bytea|binary|_data$/i
let pass = 0, fail = 0
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ' · ' + extra : ''}`)
  ok ? pass++ : fail++
}

async function verifyPath(path, label) {
  const { data: signed, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (sErr || !signed?.signedUrl) { check(false, label, `签名失败 ${sErr?.message || ''}`); return }
  const { data: blob, error: dErr } = await supabase.storage.from(BUCKET).download(path)
  check(!dErr && !!blob && blob.size > 0, label, `${path.split('/').pop()} · ${blob?.size || 0} bytes · 签名 600s`)
}

console.log('\n=== 迁移后抽查（真实 Supabase） ===\n')

// 1) 列结构：无 Base64 / 二进制字段
const { data: sample } = await supabase.from('mistake_images').select('*').limit(1)
const badCols = Object.keys(sample?.[0] || {}).filter((c) => SUSPECT.test(c))
check(badCols.length === 0, '图片表无 Base64 / Blob / 二进制字段', badCols.length ? badCols.join(',') : '仅路径与元数据')

// 2) 富文本不再有 Base64
let base64Html = 0
for (const field of ['content', 'answer', 'analysis']) {
  const { data } = await supabase.from('mistakes').select(field).like(field, '%data:image/%').limit(5)
  base64Html += (data || []).length
}
check(base64Html === 0, '错题富文本里没有 Base64 图片', base64Html ? `仍有 ${base64Html} 行，请重跑 migrate-images.mjs` : '')

// 3) 随机 5 张图：签名 + 下载
const { data: imgs } = await supabase.from('mistake_images').select('id,storage_path,image_role').limit(200)
const pool = (imgs || []).sort(() => Math.random() - 0.5).slice(0, 5)
check(pool.length > 0, '库中至少有 1 张图片可供抽查', `共 ${imgs?.length || 0} 条`)
for (let i = 0; i < pool.length; i++) await verifyPath(pool[i].storage_path, `抽查图片 ${i + 1}/5（${pool[i].image_role}）`)

// 4) 随机 3 道带整题原图的错题：原图 + OCR 文字
const { data: originals } = await supabase.from('mistake_images')
  .select('mistake_id,storage_path,id').eq('image_role', 'original').not('mistake_id', 'is', null).limit(100)
const picked = (originals || []).sort(() => Math.random() - 0.5).slice(0, 3)
check(picked.length > 0, '库中至少有 1 道带整题原图的错题', `共 ${originals?.length || 0} 张整题图`)
for (let i = 0; i < picked.length; i++) {
  const o = picked[i]
  await verifyPath(o.storage_path, `抽查整题 ${i + 1}/3 · 原图`)
  const { data: m } = await supabase.from('mistakes').select('id,title,content').eq('id', o.mistake_id).maybeSingle()
  check(!!m && !!String(m.content || '').trim(), `抽查整题 ${i + 1}/3 · 题干/OCR 文字`, m?.title || '未找到错题')
  const { data: ocr } = await supabase.from('ocr_jobs').select('id,status,raw_text').eq('image_id', o.id).limit(1)
  console.log(`        └ OCR 记录：${ocr?.length ? `${ocr[0].status}（${String(ocr[0].raw_text || '').slice(0, 24)}…）` : '无（可能是 AI 关闭时手动录入，属正常）'}`)
}

console.log(`\n=== 合计：${pass} 项通过，${fail} 项失败 ===`)
if (fail) {
  console.log('失败项请对照 docs/03「迁移步骤」与 docs/05「维护与排错」处理，然后把终端输出发给我。\n')
  process.exit(1)
}
console.log('✅ 抽查通过。注意：这只验证了「取图链路」，浏览器里列表/详情/打印/分享页的肉眼检查仍需按 docs/04 验收 VII 段逐项勾选。\n')
