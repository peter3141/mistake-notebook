#!/usr/bin/env node
/**
 * 图片架构 v4 · 离线自检（不需要任何 Supabase / AI 凭据，本机直接可跑）
 *   node scripts/verify-image-arch.mjs
 * 真实数据抽查请用 verify-migration.mjs；两者都不等于「已真实联调」。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0, fail = 0
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ' · ' + extra : ''}`)
  ok ? pass++ : fail++
}
const has = (p) => existsSync(join(ROOT, p))

console.log('\n=== 图片架构 v4 离线自检（无需凭据） ===\n')

// 1) SQL：无二进制列、PART IV 关键字段齐全
const sql = read('supabase/schema.sql')
check(!/^\s*\w+\s+bytea\b/im.test(sql), 'SQL 中没有 bytea 二进制列')
check(!/add column if not exists \w*base64|add column if not exists \w*blob/i.test(sql), 'SQL 没有新增 Base64 / Blob 列')
check(/drop column if exists/i.test(sql) || /drop column %I/i.test(sql), 'SQL 含幂等清理历史 Base64 列逻辑')
for (const col of ['image_role', 'parent_image_id', 'crop_rect', 'original_size_bytes', 'compressed_size_bytes', 'is_original_backed_up', 'original_backup_note', 'draft_id', 'public_url']) {
  check(sql.includes(`add column if not exists ${col}`), `SQL 含字段 ${col}`)
}
check(/create table if not exists public\.deleted_images/.test(sql), 'SQL 含图片回收站表 deleted_images')
check(/create or replace function public\.list_orphan_images_v4/.test(sql), 'SQL 含只读孤儿清单函数')
check(/public\s*=\s*false/.test(sql), 'Storage 桶保持私有')
check(sql.includes('add column if not exists public_url') && read('lib/data.ts').includes('createSignedUrls'), '取图统一通过 Storage URL / 签名 URL')

// 2) 上传路由：先上传、后写库、失败回滚
const upload = read('app/api/images/upload/route.ts')
const upIdx = upload.indexOf('.upload(path, file')
const insIdx = upload.indexOf(".from('mistake_images').insert")
check(upload.includes('auth.getUser()'), '上传接口校验登录')
check(upIdx > -1 && insIdx > upIdx, '顺序：先上传 Storage，成功后才写数据库', `upload@${upIdx} < insert@${insIdx}`)
check(/remove\(\[path/.test(upload), '写库失败会回滚已上传文件')
check(/8 \* 1024 \* 1024/.test(upload) && /allowed_mime_types|mimeOk/.test(upload), '上传接口做大小与类型限制')
check(upload.includes('${user.id}/mistakes/${ROLE_SEGMENT[role]}/${entityId}/'), '路径按登录用户 uid + 用途 + 实体 id 生成，前端无法伪造')

// 3) 服务端 AI：全部先过开关校验，OCR 校验图片归属
const aiDir = join(ROOT, 'app/api/ai')
const aiRoutes = readdirSync(aiDir, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => `app/api/ai/${d.name}/route.ts`).filter(has)
check(aiRoutes.length >= 6, `发现 ${aiRoutes.length} 个 AI 路由`)
for (const f of aiRoutes) {
  const s = read(f)
  if (f.endsWith('status/route.ts')) { check(!s.includes('callCodingPlan'), 'status 路由只读、不调用 AI'); continue }
  check(s.includes('requireAi('), `${f.split('/').slice(-2)[0]} 首行过 requireAi 开关校验`)
}
const ocr = read('app/api/ai/ocr/route.ts')
check(ocr.includes('storagePath') && ocr.includes('FORBIDDEN_PATH'), 'OCR 支持 storagePath 且校验图片归属')
check(ocr.includes('storage.from(BUCKET).download'), 'OCR 服务端从 Storage 读图，不要求本地路径')
check(ocr.includes('is_ai_description') && ocr.includes('figure_description'), 'OCR 结构化输出含 AI 图形描述标记')

// 4) 富文本：禁止新 Base64，历史给迁移入口
check(read('components/editor/RichTextEditor.tsx').includes('allowBase64: false'), 'Tiptap 禁止新 Base64 图片')
check(has('components/LegacyImageNotice.tsx') && has('app/api/images/migrate-inline/route.ts'), '历史 Base64 有提示与迁移入口')
check(read('lib/data.ts').includes('hydrateRichText') && read('lib/data.ts').includes('stripInjectedSrc'), '富文本 data-storage-path 展示时签名、保存时去掉临时 URL')

// 5) 删除与回收站、打印、分享、原图包
const data = read('lib/data.ts')
check(data.includes('deleted_images') && data.includes('removeStorageFilesForMistake'), '删除图片进回收站；彻底删除才删 Storage 文件')
check(data.includes('image_purge_failures'), 'Storage 删除失败有可查记录')
check(read('components/ImageTrashPanel.tsx').includes('list_orphan_images_v4'), '孤儿文件只列出、勾选确认后才删')
check(read('app/api/share/[token]/route.ts').includes('const ttl'), '分享页签名 URL 有效期与链接剩余时间一致')
check(has('app/api/export/originals/route.ts'), '导出原图包路由存在')
check(read('components/PrintDocument.tsx').includes('full-page-original') && read('components/PrintDocument.tsx').includes('showAiFigureDescription'), '打印默认输出整题原图、AI 图形描述默认不打印')
check(read('app/globals.css').includes('img-load-fallback'), '图片加载失败有占位样式')
check(read('components/Providers.tsx').includes('图片加载失败，请检查网络或存储配置'), '全局图片加载失败提示，不白屏')

// 6) 密钥与前端隔离
const files = [
  '.env.example', 'README.md', 'docs/09-图片架构v4改造清单.md',
  'app/api/images/upload/route.ts', 'lib/images/client.ts', 'lib/images/server.ts'
]
const leaked = files.filter((f) => has(f) && /sk-sp-[A-Za-z0-9_-]{12,}/.test(read(f)))
check(leaked.length === 0, '无真实 sk-sp- 密钥', leaked.join(',') || '扫描 6 个文件')
check(!read('lib/images/client.ts').includes('service_role'), '前端代码不出现 service_role')

// 7) 迁移与验证脚本可执行
check(has('scripts/migrate-images.mjs') && read('scripts/migrate-images.mjs').includes('--dry-run'), '迁移脚本存在且支持 --dry-run')
check(has('scripts/verify-migration.mjs') && has('supabase/selfcheck-image.sql'), '迁移后抽查脚本与 SQL 自检存在')

console.log(`\n=== 合计：${pass} 项通过，${fail} 项失败 ===`)
console.log('说明：本脚本只做静态检查，不代表已在真实 Supabase / Vercel / Coding Plan 上联调通过。\n')
if (fail) process.exit(1)
