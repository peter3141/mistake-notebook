#!/usr/bin/env node
/**
 * 按科目课本组卷 v5 · 离线静态自检（不需要任何 Supabase / AI 凭据，本机直接可跑）
 *   node scripts/verify-textbooks.mjs
 *
 * 只做「代码里有没有这条边界」的静态检查，
 * 不代表已在真实 Supabase / Vercel / Coding Plan 上联调通过。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const has = (p) => existsSync(join(ROOT, p))
let pass = 0, fail = 0
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ' · ' + extra : ''}`)
  ok ? pass++ : fail++
}
const safeRead = (p) => has(p) ? read(p) : ''

console.log('\n=== 按科目课本组卷 v5 离线自检（无需凭据） ===\n')

// ---------------------------------------------------------------- 1. 数据模型
const mig = safeRead('supabase/migration-textbooks.sql')
const tables = [
  'textbooks', 'textbook_chapters', 'chapter_knowledge_points',
  'chapter_mistakes', 'textbook_materials', 'textbook_quiz_templates'
]
check(has('supabase/migration-textbooks.sql'), '独立幂等迁移文件存在')
for (const t of tables) {
  check(mig.includes(`create table if not exists public.${t}`), `建表：${t}`)
  check(new RegExp(`'${t}'`).test(mig), `RLS 循环覆盖：${t}`)
}
check(mig.includes('enable row level security'), '6 张表统一启用 RLS')
check(mig.includes('create policy "own_rows"') && mig.includes('auth.uid() = user_id'), 'own_rows 策略按 user_id 隔离')
check(mig.includes('ai_textbook_quiz boolean not null default false'), 'AI 子开关默认关闭')
check(mig.includes('grant usage on schema public to authenticated, service_role'), '显式授权 schema（不依赖建库勾选项）')
check(mig.includes('grant all on all tables in schema public to authenticated, service_role'), '显式授权新表')
check(mig.includes('interval \'30 days\''), '回收站 30 天过期清理')
check(/entity_type in \([^)]*'textbook','chapter','material'/.test(mig), '回收站扩展 3 类实体')
check(mig.includes('exception when insufficient_privilege or undefined_column'), 'Storage 桶 MIME 更新有权限异常保护，不中断整份脚本')
check(!/\bbytea\b|add column[^;]*base64/i.test(mig), '迁移 SQL 无二进制 / Base64 列')
check(mig.includes('v5_tables') && mig.includes('v5_rls_true'), '提供四合一自检 SQL')
check((mig.match(/create table if not exists/g) || []).length === 6, '恰好 6 张新表')

// ---------------------------------------------------------------- 2. 课本页 / 章节树 / 材料
const tbPage = safeRead('app/(main)/textbooks/page.tsx')
const tbDetail = safeRead('app/(main)/textbooks/[id]/page.tsx')
const tbLib = safeRead('lib/textbooks.ts')
check(has('app/(main)/textbooks/page.tsx'), '课本列表页 /textbooks 存在')
check(has('app/(main)/textbooks/[id]/page.tsx'), '章节树页 /textbooks/[id] 存在')
check(tbPage.includes('grade') && tbPage.includes('edition') && tbPage.includes('subject_id'), '列表页支持科目/年级/版本筛选')
check(tbDetail.includes('parseCatalog') || tbLib.includes('parseCatalog'), '粘贴目录自动解析成章节树')
check(tbLib.includes('reorderChapters'), '章节拖拽排序')
check(tbLib.includes('textbookDeleteImpact'), '删除课本前算影响范围（二次确认）')
check(tbLib.includes('softDeleteTextbookWithRelations'), '软删除连带章节与材料进回收站')
check(tbLib.includes('linkMistakeToChapter') && tbLib.includes('addChapterKp'), '手动关联错题与知识点')
check(tbLib.includes('uploadTextbookMaterial'), '材料上传走统一封装')

const upload = safeRead('app/api/images/upload/route.ts')
check(upload.includes('handleTextbookUpload'), '上传接口有课本材料分支')
check(upload.includes('application/pdf'), '课本材料允许 PDF 片段')
check(upload.includes('${userId}/textbooks/'), 'Storage 路径首段为 uid（命中 img_*_own 策略）')
check(upload.includes('storage_path: path') && !upload.includes('base64'), 'DB 只存路径，不存 Base64')
check(upload.includes('remove([path])'), '写库失败回滚已上传文件')

// ---------------------------------------------------------------- 3. 组卷页 / 抽题 / 打印
const random = safeRead('app/(main)/review/random/page.tsx')
const draw = safeRead('lib/textbooks.ts')
check(random.includes("'random' | 'textbook'") || random.includes("mode === 'textbook'"), '组卷页有双模式切换')
check(random.includes('来源章节'), '结果页有「来源章节」列')
check(draw.includes('drawByChapters') && draw.includes('chapter_mistakes'), '抽题第一优先：章节直接关联错题')
check(draw.includes('chapter_knowledge_points'), '抽题第二优先：知识点 / 标签间接命中')
const drawStart = draw.indexOf('export async function drawByChapters')
const drawEnd = draw.indexOf('// =====', drawStart + 10)
const drawSeg = drawStart >= 0 ? draw.slice(drawStart, drawEnd > 0 ? drawEnd : undefined) : ''
check(drawSeg.length > 0 && !drawSeg.includes('/api/ai/'), 'drawByChapters 函数体内不调用任何 AI 接口')
check(random.includes('shortfall') && random.includes('是否用 AI 基于你上传的课本材料补充生成'), '错题不足才提示 AI 补充')
check(random.includes('includeInPrint: false'), 'AI 题默认不打印')
check(random.includes("i.kind === 'ai' && i.includeInPrint"), '只有手动勾选的 AI 题才进打印')
check(random.includes('confirmAiCandidates') && random.includes('逐题勾选确认'), 'AI 结果先预览逐题确认')
check(random.includes('regenerateOne') && random.includes('editingIdx'), 'AI 题可编辑 / 删除 / 单题重生成')
check(random.includes('saveQuizTemplate'), '组卷配置可存模板复用')
const selector = safeRead('components/ChapterSelector.tsx')
check(has('components/ChapterSelector.tsx') && selector.includes('Search') && selector.includes('搜索章节标题') && selector.includes('kw'), '章节选择器支持搜索章节标题（移动端可用）')

// ---------------------------------------------------------------- 4. AI 路由与边界
const quiz = safeRead('app/api/ai/textbook-quiz/route.ts')
const prompts = safeRead('lib/ai/quiz-prompts.ts')
const guard = safeRead('lib/ai/guard.ts')
const settings = safeRead('app/(main)/settings/page.tsx')
check(has('app/api/ai/textbook-quiz/route.ts'), 'AI 出题服务端路由存在')
const guardIdx = quiz.indexOf("requireAi('textbook_quiz')")
const callIdx = quiz.indexOf('callCodingPlan(')
check(guardIdx >= 0 && guardIdx < callIdx, 'requireAi 在发起任何上游调用之前（零调用零费用）')
const matIdx = quiz.indexOf('INSUFFICIENT_MATERIAL')
check(matIdx >= 0 && matIdx < callIdx, '材料门禁在发起任何上游调用之前')
check(quiz.includes('textbook_materials'), '材料门禁读数据库里用户自己的材料，不信任请求体')
check(quiz.includes('422'), '材料不足返回明确状态码而非编题')
check(guard.includes("ai_textbook_quiz: false") && guard.includes("textbook_quiz: 'ai_textbook_quiz'"), '子开关注册且默认关闭')
check(prompts.includes('没有联网能力') && prompts.includes('不得引入材料之外的内容') && prompts.includes('不要编造'), '提示词明确禁止联网/材料外内容/编题')
check(prompts.includes('insufficient') && prompts.includes('confidence_note'), '返回结构化 JSON 且材料不足可返回原因')
check(quiz.includes('assertRateLimit') && quiz.includes('aiErrorResponse'), '限流与失败统一中文提示，不静默降级')
check(settings.includes('课本AI出题') && settings.includes('AI未配置') && settings.includes('已开启') && settings.includes('已关闭'), '设置页显示 AI未配置/已关闭/已开启 三态')
check(random.includes('ai.can(\'textbook_quiz\')') && random.includes('disabled={!aiButtonEnabled}'), 'AI 不可用时按钮置灰')
check(!/insert\([\s\S]{0,200}mistakes/.test(tbLib + quiz), 'AI 生成题不写入错题库')

// ---------------------------------------------------------------- 5. 文档 / 校验 / 现有能力保留
check(safeRead('docs/03-部署步骤.md').includes('V7 · v5'), 'docs/03 有 v5 升级步骤')
check(safeRead('docs/04-验收清单.md').includes('VIII · v5') || safeRead('docs/04-验收清单.md').includes('v5'), 'docs/04 有 v5 验收清单')
check(safeRead('docs/05-使用与维护手册.md').includes('第八部分 · v5'), 'docs/05 有课本管理与组卷教学')
check(safeRead('README.md').includes('v5'), 'README 有 v5 说明')
check(safeRead('docs/05-使用与维护手册.md').includes('未实现'), '文档如实标注未实现项')
check(safeRead('package.json').includes('verify:textbooks'), '静态自检脚本已登记到 npm scripts')
check(safeRead('app/api/backup/export/route.ts').includes('textbook_materials'), '备份导出包含 6 张新表')
check(safeRead('scripts/verify-image-arch.mjs').includes('verify-image-arch'), 'v4 图片校验脚本仍在（现有能力未被破坏）')

console.log(`\n=== 合计：${pass} 项通过，${fail} 项失败 ===`)
console.log('说明：本脚本只做静态检查，不代表已在真实 Supabase / Vercel / Coding Plan 上联调通过。\n')
process.exit(fail ? 1 : 0)
