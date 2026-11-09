#!/usr/bin/env node
/**
 * 真实联调自检脚本（只读检查 + 一次最小 AI 调用，不会写数据库、不会删除任何东西）
 *
 * 用法：
 *   node scripts/healthcheck.mjs            # 检查环境变量 / Supabase / 站点 / API 健康
 *   node scripts/healthcheck.mjs --ai       # 额外做一次 Coding Plan 最小调用（会消耗极小配额）
 *   node scripts/healthcheck.mjs --site https://你的域名.vercel.app   # 指定线上站点
 *
 * Windows（PowerShell 或 Git Bash）与 macOS（终端）命令完全一样，都要先进入项目目录。
 * 前提：项目根目录有 .env.local（本地），或已把同名变量设进系统环境变量。
 *
 * ★ 本脚本只是「帮你把凭据填好后自己验一遍」，跑通了也不等于「已联调通过」；
 *   真正跨设备同步、图片上传、导出、Anki 导入仍需在浏览器里按 docs/08 逐项验收。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const withAi = args.includes('--ai')
const siteArgIdx = args.indexOf('--site')
const siteArg = siteArgIdx >= 0 ? args[siteArgIdx + 1] : ''

// ---------- 读取 .env.local（不打印任何值） ----------
function loadEnv() {
  const file = resolve(process.cwd(), '.env.local')
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}
const fileEnv = loadEnv()
const env = (k) => process.env[k] || fileEnv[k] || ''
const mask = (v) => !v ? '(未填)' : `${v.slice(0, 6)}…${v.slice(-4)}（长度 ${v.length}）`

const results = []
const add = (level, name, detail) => {
  results.push({ level, name, detail })
  console.log(`[${level}] ${name}${detail ? ' — ' + detail : ''}`)
}
const OK = (n, d) => add('OK', n, d)
const WARN = (n, d) => add('WARN', n, d)
const FAIL = (n, d) => add('FAIL', n, d)
const SKIP = (n, d) => add('SKIP', n, d)

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(t) }
}

console.log('='.repeat(76))
console.log('个人综合管理网站 · 真实联调自检')
console.log('模式：' + (withAi ? '包含 Coding Plan 最小调用（--ai）' : '只读检查（未加 --ai，不发 AI 请求）'))
console.log('='.repeat(76))

// ---------- 1. 环境变量 ----------
console.log('\n--- 1. 环境变量（只显示掩码，绝不打印完整密钥）---')
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
for (const k of required) {
  if (env(k)) OK(k, mask(env(k)))
  else FAIL(k, '未配置。去 Supabase → Project Settings → API 复制，填进 .env.local 或 Vercel 环境变量')
}
const siteUrl = siteArg || env('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000'
OK('站点地址', siteUrl)

const aiKey = env('DASHSCOPE_CODING_API_KEY')
const aiBase = env('AI_BASE_URL')
const textModel = env('AI_MODEL') || 'qwen3.7-plus'
const visionModel = env('VISION_MODEL') || env('AI_MODEL') || 'qwen3.7-plus'
console.log('  AI 配置（可选）：')
if (!aiKey) WARN('DASHSCOPE_CODING_API_KEY', '未配置 → 设置页会提示「AI未配置」，非 AI 功能仍应全部可用')
else if (!aiKey.startsWith('sk-sp-')) FAIL('DASHSCOPE_CODING_API_KEY 格式', '必须以 sk-sp- 开头；普通 sk- 是百炼按量计费 Key，不能混用')
else OK('DASHSCOPE_CODING_API_KEY 格式', mask(aiKey))
if (!aiBase) WARN('AI_BASE_URL', '未配置（应为 https://coding.dashscope.aliyuncs.com/v1）')
else if (aiBase.replace(/\/$/, '') !== 'https://coding.dashscope.aliyuncs.com/v1')
  FAIL('AI_BASE_URL', `当前是 ${aiBase}；Coding Plan 只允许 https://coding.dashscope.aliyuncs.com/v1，含 maas / compatible-mode 的通用端点会 403`)
else OK('AI_BASE_URL', aiBase)
OK('文本模型 AI_MODEL', textModel)
OK('视觉模型 VISION_MODEL', visionModel)

// ---------- 2. Supabase 连通 ----------
console.log('\n--- 2. Supabase 连通（只读 /auth/v1/settings）---')
const supaUrl = env('NEXT_PUBLIC_SUPABASE_URL')
const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!supaUrl || !anon) SKIP('Supabase 连通', '缺少 URL 或 anon key')
else {
  try {
    const r = await fetchWithTimeout(`${supaUrl}/auth/v1/settings`, { headers: { apikey: anon } })
    if (r.ok) OK('Supabase Auth 端点', `HTTP ${r.status}，Key 有效`)
    else FAIL('Supabase Auth 端点', `HTTP ${r.status} ${await r.text().then((s) => s.slice(0, 160)).catch(() => '')}（检查 URL 是否拼错、anon key 是否复制完整、项目是否暂停）`)
  } catch (e) { FAIL('Supabase Auth 端点', `请求失败：${e.message}（检查网络 / 代理 / 项目区域）`) }
}

// ---------- 3. 站点与 API 健康 ----------
console.log('\n--- 3. 站点与 API 健康（本地需先 npm run dev；线上填 --site 域名）---')
try {
  const r = await fetchWithTimeout(`${siteUrl}/login`, {}, 10000)
  if (r.ok) OK('登录页 /login', `HTTP ${r.status}`)
  else FAIL('登录页 /login', `HTTP ${r.status}`)
} catch (e) { WARN('登录页 /login', '连不上：' + e.message + '（本地没起服务属正常；线上请检查 Vercel 部署状态）') }

for (const path of ['/api/ai/status', '/api/settings', '/api/export/word']) {
  try {
    const r = await fetchWithTimeout(`${siteUrl}${path}`, {
      method: path === '/api/export/word' ? 'POST' : 'GET',
      headers: path === '/api/export/word' ? { 'Content-Type': 'application/json' } : {},
      body: path === '/api/export/word' ? '{}' : undefined
    }, 15000)
    // 401/400 都说明路由存在且被安全策略拦住了；404 才是没部署
    if (r.status === 404) FAIL(`路由 ${path}`, 'HTTP 404（代码没部署成功，或路径写错）')
    else OK(`路由 ${path}`, `HTTP ${r.status}（401/400 属正常：未登录或参数校验生效）`)
  } catch (e) { WARN(`路由 ${path}`, '连不上：' + e.message) }
}

// ---------- 4. Coding Plan 最小调用 ----------
console.log('\n--- 4. Coding Plan 最小调用（仅 --ai 时执行）---')
if (!withAi) SKIP('Coding Plan 调用', '未加 --ai，本次零 AI 请求、零费用')
else if (!aiKey || !aiBase) FAIL('Coding Plan 调用', '缺少 Key 或 Base URL')
else {
  try {
    const r = await fetchWithTimeout(`${aiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: textModel, stream: false, max_tokens: 12,
        messages: [{ role: 'user', content: '请只回复两个字：正常' }]
      })
    }, 20000)
    const txt = await r.text()
    if (r.ok) OK('Coding Plan /chat/completions', `HTTP 200，模型 ${textModel} 可用，返回片段：${txt.slice(0, 120)}`)
    else {
      FAIL('Coding Plan /chat/completions', `HTTP ${r.status}：${txt.slice(0, 220)}`)
      console.log('  排查提示：')
      if (r.status === 401) console.log('   → 401 invalid access token：Key 不对/过期/复制带了空格，重新去 Coding Plan 页复制 sk-sp- 开头的专属 Key。')
      if (r.status === 403) console.log('   → 403 invalid api-key：多半误用了通用按量计费 Base URL（maas / compatible-mode），或把普通 sk- Key 填进了 Coding Plan。')
      if (r.status === 404) console.log('   → 404：Base URL 路径错，必须是 https://coding.dashscope.aliyuncs.com/v1 + /chat/completions。')
      if (r.status === 429) console.log('   → 429 / quota exceeded：请求太密或套餐额度用尽，稍后再试或到控制台看配额。')
      if (/model.*not supported|not found|invalid model/i.test(txt)) console.log('   → 模型 ID 不支持：检查大小写、前后空格、是否精确版本（如 qwen3.7-plus，不是 qwen3.7）。')
    }
  } catch (e) { FAIL('Coding Plan 调用', '请求失败：' + e.message + '（检查网络、代理、20 秒超时）') }
}

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(76))
const count = (l) => results.filter((r) => r.level === l).length
console.log(`汇总：OK ${count('OK')} · WARN ${count('WARN')} · FAIL ${count('FAIL')} · SKIP ${count('SKIP')}`)
console.log('说明：本脚本通过 ≠ 已联调通过。仍需按 docs/08-真实联调清单.md 在浏览器里逐项验证。')
if (count('FAIL') > 0) {
  console.log('\n把下面这些发给助手，我会按报错继续修：')
  console.log('  1) 本脚本的完整输出（可截图，注意别把完整 Key 截进去）')
  console.log('  2) Vercel → Project → Logs 里对应时间的报错')
  console.log('  3) 浏览器 F12 → Console / Network 里失败请求的 Status 与 Response')
  console.log('  4) 你正在做 docs/08 的哪一项、期望看到什么、实际看到什么')
  process.exit(1)
}
console.log('没有 FAIL：可以继续按 docs/08 做浏览器端逐项验收。')
