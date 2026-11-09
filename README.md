# 个人综合管理网站 PersonalHub

> **v2（第 7 段增量）**：本项目已由「错题本网站」升级为「个人综合管理网站」。错题本保留为**核心模块之一，原有功能一项不少**；新增日程、待办、笔记、习惯打卡、番茄钟、目标管理、统一搜索、统一回收站与聚合仪表盘。
> 合并后的完整 PRD 见 [`docs/06-个人综合管理网站-增量整合方案.md`](docs/06-个人综合管理网站-增量整合方案.md)；原错题本详细规格见 [`docs/01-产品与技术方案.md`](docs/01-产品与技术方案.md)。

错题本核心闭环：录入 → 编辑（富文本/公式/多图）→ 时间分类 → AI 整理（可选）→ 复习闭环 → 随机组卷 → 一键打印/PDF → 统计薄弱点。
全站闭环：今日日程 / 待办 / 待复习 / 习惯 / 专注一屏聚合，模块间可互相跳转与生成。
Next.js 14 + Supabase(Postgres/Auth/Storage/RLS) + Tailwind + Tiptap + KaTeX，部署到 Vercel 后公网可访问，手机与电脑登录同一账号即云端同步。

> **AI 是可插拔的**：默认关闭。关闭后不产生任何 AI 请求与费用，全部非 AI 功能照常可用。
> 本项目 AI 后端固定使用**阿里云百炼 Coding Plan**（OpenAI 兼容 Chat/Completions），配置见下方第 6 节。

> **v3 补完（本次）**：补齐 ① 导出 Word（图片 Base64 真内嵌）② 导出 Anki 卡片 ③ 浏览器端本地离线 OCR ④ 习惯历史日期补录。
> **四项全部不依赖 AI**，AI 总开关关闭 / Key 未配置时照常可用、零费用。详见第 11 节与 `docs/05` 第六部分。
> ⚠️ **未真实联调**：凭据清单与逐项验证步骤见 [`docs/08-真实联调清单.md`](docs/08-真实联调清单.md)。

> **v4 图片架构（本次）**：数据库只存路径与元数据（零 Base64 / 零二进制）；新增「整题拍照上传 → OCR 预览 → 文字进题干 + 整图存附件 + 手动裁剪」、图片回收站、孤儿清理、导出原图包、幂等迁移脚本。
> **网站运行没有新增环境变量**，Coding Plan 与 AI 开关配置方式一字未改。详见 [`docs/09-图片架构v4改造清单.md`](docs/09-图片架构v4改造清单.md) 与第 12 节。

---

## 0. 模块与路由（v2）

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 聚合仪表盘 | `/` | 今日日程 / 待办 / 待复习错题 / 习惯打卡 / 今日专注 + 错题分布 |
| **错题本**（v1 全功能） | `/mistakes`、`/mistakes/new`、`/mistakes/[id]`、`/review`、`/review/random`、`/print` | 录入、富文本多图、AI整理预览确认、版本回滚、**AI OCR + 本地 OCR**、复习闭环、组卷、A4 打印四模板、**导出 Word / Anki**、**拍照上传整题（OCR 预览确认 + 整题原图 + 手动裁剪）** |
| 日程 | `/calendar` | 日/周/月视图、提醒、重复、分类优先级、关联错题、按范围打印导出 PDF、AI 自然语言建日程（预览确认） |
| 待办 | `/tasks` | 优先级、截止、子任务、重复、筛选排序、与日程/番茄钟联动 |
| 笔记 | `/notes` | 富文本 + 公式 + 图片 + 标签 + 历史版本 + 只读分享 + AI 总结（预览确认） |
| 习惯 | `/habits` | 每日打卡、**历史日期补录/取消（二次确认、防重复）**、连续天数、月视图、统计、提醒 |
| 番茄钟 | `/focus` | 专注计时、关联待办/错题、专注记录与统计、休息提醒 |
| 目标 | `/goals` | 长期目标、里程碑、进度、关联待办与习惯 |
| 统一搜索 | `/search` | 跨错题/日程/待办/笔记/标签，按模块分组 |
| 统一回收站 | `/trash` | 6 类实体，30 天可恢复，清空二次确认；**图片回收站（彻底删才删 Storage 文件）+ 孤儿文件扫描（只读列出、勾选确认才删）** |
| 统计 | `/stats` | 错因分布、知识点热力图、趋势、复习完成率 + 全模块概览 |
| 设置 | `/settings` | AI 总/子开关、**本地 OCR 语言与缓存说明**、日程提醒、专注时长、打印模板、分享管理、备份恢复、**导出原图包**、账号安全 |
| 只读分享页 | `/share/[token]` | 错题 / 笔记 / 日程，隐藏编辑按钮与隐私字段 |

**联动**：错题复习计划 → 一键生成日程/待办；日程关联错题可跳转；番茄钟关联待办/错题并回写专注时长；目标关联待办与习惯；首页聚合 5 类今日数据。

---

## 1. 快速开始（本地运行）

环境：Node.js ≥ 18.17（推荐 20/22）、npm。

```bash
git clone https://github.com/你的用户名/mistake-notebook.git
cd mistake-notebook
npm install
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
```

编辑 `.env.local`，至少填 3 个 Supabase 值（见第 3 节）：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

```bash
npm run dev
```

预期：`▲ Next.js 14.2.15` / `- Local: http://localhost:3000` / `✓ Ready`。打开 `http://localhost:3000` 注册账号即可。

其他脚本：

```bash
npm run typecheck   # TypeScript 类型检查（预期无输出即通过）
npm run build       # 生产构建（预期 ✓ Compiled successfully）
npm run start       # 本地运行生产构建
```

---

## 2. 数据库初始化

1. Supabase 创建项目（Region 建议 Singapore / Tokyo）。
2. **SQL Editor → New query** → 粘贴 `supabase/schema.sql` 全文 → **Run**。预期 `Success. No rows returned`。
3. 自检：

```sql
select tablename, rowsecurity as rls from pg_tables where schemaname='public' order by tablename;
select id, public from storage.buckets where id='mistake-images';
```

预期 **30 行**（v1 16 张 + v2 14 张）`rls = true`；桶 `public = false`（私有桶）。
老项目升级：**整份重跑同一个文件即可**，幂等、不丢数据；升级步骤见 `docs/03-部署步骤.md` 末尾「v2 增量部署说明」。

4. **Authentication → Providers → Email**：启用；个人用建议关闭 `Confirm email`。
5. **Authentication → URL Configuration**：
   `Site URL` = `http://localhost:3000`（部署后换成 Vercel 域名）；
   `Redirect URLs` 加 `http://localhost:3000/api/auth/callback` 与 `https://<域名>/api/auth/callback`。

SQL 会自动创建 31 张表（PART I~IV）、全表 RLS、私有图片桶策略、新用户初始化触发器、错题/笔记历史版本触发器、统一回收站登记触发器与恢复/清理函数、注销函数、v4 图片回收站与孤儿文件视图。表结构与字段说明见 `docs/02-数据库与目录说明.md`（v1）与 `docs/07-数据库与目录说明-v2增量.md`（v2）。

---

## 3. 环境变量

| 变量 | 必填 | 来源 | 说明 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Settings → API → Project URL | 公开 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | 同上 → anon public | 公开，受 RLS 保护 |
| `SUPABASE_SERVICE_ROLE_KEY` | 分享功能需要 | 同上 → service_role secret | **保密**，仅服务端，禁止 `NEXT_PUBLIC_` 前缀 |
| `NEXT_PUBLIC_SITE_URL` | ✅ | 本地 `http://localhost:3000`，部署后 Vercel 域名 | 用于生成分享链接与魔法链接回调 |
| `AI_BASE_URL` | 用 AI 时 | 固定 `https://coding.dashscope.aliyuncs.com/v1` | Coding Plan 专用 |
| `DASHSCOPE_CODING_API_KEY` | 用 AI 时 | 百炼 Coding Plan 页面 | **保密**，`sk-sp-` 开头 |
| `AI_MODEL` | 否 | `qwen3.7-plus` | 文本整理 / 相似题 / **AI日程解析 / AI笔记总结** |
| `VISION_MODEL` | 否 | `qwen3.7-plus` | 图片理解（必须支持视觉） |
| `OCR_MODEL` | 否 | `qwen3.7-plus` | OCR（必须支持视觉） |
| `AI_TIMEOUT_MS` | 否 | `30000` | 单次调用超时 |
| `AI_MAX_RETRIES` | 否 | `1` | 失败重试上限（4xx/429 不重试） |

**未配置 Key / Base URL 时**：`/api/ai/status` 返回 `configured:false` 与 `configIssues`，设置页显示「AI未配置」，所有 AI 入口自动禁用，其余功能完全正常，不白屏。

---

## 4. 部署到公网（Vercel）

1. 代码推到 GitHub（**不要提交 `.env.local`**，`.gitignore` 已排除）。
2. Vercel → `Add New → Project` → Import 仓库 → Framework 自动识别 Next.js，构建配置保持默认。
3. 在 Environment Variables 填入第 3 节的变量（AI 相关可以先不填）。
4. `Deploy` → 得到 `https://<项目>.vercel.app`。
5. 回 Supabase 把 `Site URL` / `Redirect URLs` 改成该域名；同时把 Vercel 的 `NEXT_PUBLIC_SITE_URL` 改为该域名并 Redeploy。
6. 公网验证：电脑 Wi-Fi 登录并录一道题 → 手机 4G 登录同一账号 → 应看到同一批错题。

详细逐步命令、预期输出与故障排查见 `docs/03-部署步骤.md`；纯小白图文教学见 `docs/05-使用与维护手册.md`。

替代部署：Cloudflare Pages（带宽不限）、Netlify（100 GB）、自托管 Node（`npm run build && npm run start` + Nginx）。数据库替代：自建 Postgres + PostgREST/GoTrue，或 Neon；图片替代：Cloudflare R2。免费额度见 `docs/01-产品与技术方案.md` 第六节。

---

## 5. 打印与 PDF 测试

1. `/mistakes` 勾选多题 →「打印选中」；或详情页「单题打印」；或 `/review/random` 抽题后「生成练习卷」。
2. `/print` 选择模板：学生版 / 答案版 / 复习版 / 错因复盘版；勾选要打印的字段；可保存为模板复用。
3. 点「打印 / 导出PDF」→ Chrome/Edge 打印对话框 → 目标「另存为 PDF」→ 纸张 **A4** → 勾选「背景图形」。
4. 验收：导航与按钮不出现；`.print-block` 整体不跨页；图片 `max-height:85mm` + `object-fit:contain` 不截断。

打印样式集中在 `app/globals.css` 的 `@media print` 段；渲染组件是 `components/PrintDocument.tsx`，屏幕预览与打印共用同一份 DOM。

---

## 6. 阿里云百炼 Coding Plan 配置（**重点**）

| 项 | 正确值 |
| --- | --- |
| 协议 | OpenAI 兼容 **Chat/Completions**：`POST {AI_BASE_URL}/chat/completions`；**不要用 Responses API** |
| Base URL | `https://coding.dashscope.aliyuncs.com/v1` |
| ❌ 禁用 | 任何含 `maas.aliyuncs.com`、`compatible-mode/v1`、`dashscope.aliyuncs.com/compatible-mode` 的通用按量计费地址 |
| API Key | Coding Plan **专属** Key，格式 `sk-sp-xxxxx`，放 `DASHSCOPE_CODING_API_KEY` |
| ❌ 禁用 | 普通百炼按量计费 `sk-` Key（与 Coding Plan 不互通，混用会鉴权失败或额外扣费） |
| 文本模型 | `qwen3.7-plus`（也可 `qwen3.6-plus` / `glm-5` / `MiniMax-M2.5`） |
| 视觉/OCR 模型 | `qwen3.7-plus`（也可 `qwen3.6-plus` / `kimi-k2.5`）—— 必须明确支持图片理解 |
| 模型 ID | 区分大小写、无空格、精确版本（`qwen3.7-plus` ✅，`qwen3.7` ❌） |

服务端实现：`lib/ai/config.ts`（配置自检）、`lib/ai/coding-plan.ts`（唯一上游调用出口）、`lib/ai/guard.ts`（开关校验）、`app/api/ai/{organize,ocr,similar,schedule-parse,note-summary,status}/route.ts`。
v2 新增的 `schedule-parse` / `note-summary` 是**纯文本任务**，只用 `AI_MODEL`，不调用视觉模型；两者同样「只返回预览，用户确认后才写库」，并受同一套开关、限流、缓存、超时、用量记录保护。

**请求体**（OpenAI Chat/Completions）：

```json
{
  "model": "qwen3.7-plus",
  "messages": [
    { "role": "system", "content": "…只输出 JSON…" },
    { "role": "user", "content": "请整理下面这道错题…" }
  ],
  "temperature": 0.2,
  "max_tokens": 2000
}
```

图片题时 `user.content` 改为数组：`[{type:"text",text:"…"},{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}]`，并自动切到 `VISION_MODEL` / `OCR_MODEL`。

**结构化输出**（`AiOrganizeResult`）：`normalizedStem`、`knowledgePoints[]`、`cause`、`steps[]`、`answerPoints[]`、`tags[]`、`difficulty`、`reviewAdvice`、`similarQuestions[]`。
`/api/ai/organize` **只返回结果不写库**；前端预览后用户点「确认应用」才由前端写 `mistakes`，数据库触发器自动留历史版本，可随时回滚。相似题在界面固定标注「AI生成，需核对」，不进入题目主表、不参与组卷。

**成本与稳定性**：输入长度限制（文本 ≤8000 字符、图片 base64 ≤4MB）、30s 超时、每用户每分钟 10 次/每天 100 次限流、`ai_jobs.input_hash` 结果缓存、`AI_MAX_RETRIES=1`（4xx/429 不重试）、`ai_usage_logs` 记录每次真实调用、批量前显示预计调用次数。

**常见报错**：

| 报错 | 处理 |
| --- | --- |
| `401 invalid access token` | Key 不对/过期/被重置 → 百炼 Coding Plan 页面重新获取 `sk-sp-` Key，更新 Vercel 变量并 Redeploy |
| `model 'xxx' is not supported` | 模型 ID 拼写/大小写/版本错 → 用 `qwen3.7-plus` 等精确 ID；检查订阅是否有效 |
| `403 invalid api-key` | 误用通用 Base URL 或普通 `sk-` Key → 改回 `https://coding.dashscope.aliyuncs.com/v1` + `sk-sp-` Key |
| `404` | Base URL 路径错 → 末尾只到 `/v1`，代码自动拼 `/chat/completions` |
| `429 / quota exceeded` | 请求密集或套餐额度用尽 → 周额度每周一 00:00(UTC+8) 重置，月额度订阅日重置；可先关闭 AI 总开关 |

> 任何真实 Key 都**不会**出现在前端代码、API 响应、日志或本文档中。

---

## 7. AI 功能开关（总开关 + 子开关）

开关存在 `user_settings` 表，跨设备同步；**服务端以数据库为准**，不信任前端。

| 层级 | 字段 | 控制的路由 / 入口 |
| --- | --- | --- |
| 总开关 | `ai_enabled`（默认 `false`） | 所有 `/api/ai/*`，关闭时返回 `403 AI_DISABLED`「AI功能已关闭」 |
| 子开关 | `ai_organize` | `POST /api/ai/organize`、详情页「AI整理」 |
| 子开关 | `ai_ocr` | `POST /api/ai/ocr`、图片上的识别按钮 |
| 子开关 | `ai_similar` | `POST /api/ai/similar`、详情页相似题 |
| 子开关 | `ai_batch` | 列表页「AI批量整理」 |
| 子开关 | `ai_schedule_parse` | `POST /api/ai/schedule-parse`、日程页「AI自然语言创建日程」 |
| 子开关 | `ai_note_summary` | `POST /api/ai/note-summary`、笔记页「AI笔记总结」 |
| 子开关 | `ai_plan` | 预留（默认关，不绑定任何路由） |

执行顺序（`lib/ai/guard.ts`，**在发起任何 fetch 之前**）：登录校验 → 总开关 → 子开关 → 环境变量配置 → 才允许调用 Coding Plan。
**5 个会调用 Coding Plan 的路由**（`organize` / `ocr` / `similar` / `schedule-parse` / `note-summary`）第一行都是 `requireAi(...)`；总开关关闭时一律返回 `403 {"error":"AI功能已关闭","code":"AI_DISABLED"}`，零外部请求、零费用。
`GET /api/ai/status` 只读开关与配置状态，**永不触发 AI 请求**，供 `components/AiProvider.tsx` 决定隐藏/置灰入口，供设置页显示「AI功能当前状态：已开启/已关闭」与模型名。

关闭 AI 后仍完全可用：新建/编辑、图片上传压缩、富文本与公式、时间分类、筛选搜索、统一搜索、复习闭环、随机组卷（手动抽题）、**日程、待办、笔记、习惯打卡、番茄钟、目标管理、日程打印导出、统一回收站**、打印/PDF、导出、备份恢复、统计页。原来由 AI 生成的区域显示「AI功能已关闭」，不报错。

重新开启只需在 `/settings` 打开开关，**无需重新部署**。

---

## 8. 备份与恢复

- 导出：设置页「导出 JSON 全量备份」/「导出 CSV」→ 走 `GET /api/backup/export?format=json|csv`。JSON 含 **28 张业务表**的当前用户数据（含日程、待办、笔记、习惯、专注、目标、附件、回收站登记）；CSV 只含错题扁平清单。
- 导入：粘贴 JSON（或 CSV 解析后的行数组）到设置页 → `POST /api/backup/import` 先 `{preview:true}` 返回字段映射与**各模块条数** → 确认后 `{preview:false}` 按**新 id 追加**，不覆盖已有数据；支持错题 / 笔记 / 待办 / 日程 / 习惯。
- 图片：备份里存的是 Storage 路径与签名信息；恢复图片需保留原 Supabase Storage 桶（或先把桶内文件迁到新项目相同路径）。
- 建议每月导出一次并存网盘。Supabase 免费版**不含自动备份**，且连续 7 天无访问会暂停项目。

---

## 9. 安全说明

- 31 张业务表全表 RLS：`auth.uid() = user_id`；子表带 `user_id` 冗余列，策略一致。
- 统一回收站的恢复/彻底删除走 `security definer` 函数，内部**白名单表名映射 + `auth.uid()` 二次过滤**，杜绝越权与 SQL 注入。
- 私有 Storage 桶 `mistake-images`，路径首段 = 用户 ID，4 条策略限制 select/insert/update/delete；读取用 1 小时签名 URL。
- 只读分享不开放 anon RLS，改由 `/api/share/[token]` 用 `SUPABASE_SERVICE_ROLE_KEY` 在服务端校验 token/过期/撤销，并按白名单返回脱敏字段。
- `DASHSCOPE_CODING_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 只在服务端 `process.env` 读取；错误响应统一脱敏，不会回显 Key。
- 所有 `/api/ai/*` 输入用 zod 校验；富文本写入前 `sanitizeHtml` 白名单清洗；SQL 全部通过 SDK 参数化。
- 删除、清空回收站、注销账号统一二次确认（注销需手动输入「注销」）。
- PWA 离线只读：Service Worker 不缓存 `/api/*` 与任何写操作；离线时前端禁用保存，禁止静默覆盖云端。

---

## 10. 目录与文档

```
app/            页面（22 个）+ /api 路由（20 个，新增 images/upload|migrate-inline、export/originals）
lib/            data.ts / data-v2.ts / supabase / ai / export / ocr / images(压缩·上传·服务端常量)
components/     UI、编辑器、AI 入口包装、FullPageCaptureDialog、ImageCropper、
                ImageTrashPanel、LegacyImageNotice、export/OriginalPackageButton、LocalOcrSettings
types/          全站类型（含 7 种 AI 能力、10 类新实体、ImageRole / CaptureItem / FullPageOcrResult）
supabase/schema.sql  PART I~IV（31 张业务表 + RLS + Storage + 触发器 + v4 图片架构），整份执行一次
supabase/selfcheck.sql       真实联调用数据库自检（10 项）
supabase/selfcheck-image.sql v4 图片架构自检（12 项）
scripts/healthcheck.mjs      环境变量/Supabase/站点/API/Coding Plan 最小调用自检
scripts/verify-export.mjs    导出链离线自检（WebP→PNG、docx 内嵌、Anki 媒体包）
scripts/verify-image-arch.mjs   v4 图片架构离线自检（46 项，无需凭据）
scripts/migrate-images.mjs      历史 Base64 图片迁移（幂等、支持 --dry-run）
scripts/verify-migration.mjs    迁移后抽查 5 张图 + 3 道整题错题（需 service_role）
public/         PWA（manifest / sw.js / icon）
docs/01 产品与技术方案(v1 原文)   docs/02 数据库与目录(v1)
docs/03 部署步骤(含 v2 / V5 / V6 图片架构迁移)  docs/04 验收清单(22 + 12 + 10 + 20 = 64 条)
docs/05 使用与维护手册(第一~四部分 v1、第五部分 v2、第六部分补完、第七部分 v4 图片与整题上传)
docs/06 v2 PRD   docs/07 v2 数据库增量   docs/08 真实联调清单（未真实联调）
docs/09 图片架构 v4 改造清单与迁移说明
```

> 口径说明：`schema.sql` 里实际是 **31 条 `create table`**（原 29 张 + v4 的 `deleted_images`、`image_purge_failures`）；`supabase/selfcheck.sql` 与 `docs/08` 均按 31 判定。早期文档写「30 张表」是把统一回收站的函数/视图能力一并计入的旧口径。

**非技术用户请直接看 `docs/05-使用与维护手册.md`**，按「第1步、第2步」教注册、部署、错题本与全部新模块的日常使用、维护排错，含 Windows/Mac 分别操作、每条命令的预期输出、每阶段验证方法、截图占位与验收清单；本次补完的 4 项集中在**第六部分**。

**升级用户请先读** `docs/03-部署步骤.md` 末尾的 V2 与 V5 增量说明：整份重跑 `supabase/schema.sql` → 推代码 → **无需新增/修改任何环境变量**。

---

## 11. v3 补完功能（Word / Anki 导出、本地 OCR、习惯补录）

### 11.1 入口与实现

| 能力 | 入口 | 服务端 | 说明 |
| --- | --- | --- | --- |
| 导出 Word | 错题详情「导出这道错题」、列表「选中 N 道」与「当前筛选结果」 | `POST /api/export/word` | `docx` 生成真正 `.docx`，A4 排版；`sharp` 把 WebP 转 PNG 并读尺寸；图片 Base64 写入 `word/media/` + `r:embed`，**随文件走、换电脑/断网不丢图** |
| 导出 Anki | 同上 | `POST /api/export/anki` | `jszip` 输出 `mistakes.tsv`（Front/Back）、`mistakes.csv`、`mistakes.tsv.media/` 图片、`导入说明.txt` |
| 本地 OCR | 图片右上角绿色扫描线按钮；设置页「OCR 识题设置」 | **无服务端路由** | `tesseract.js` 动态 import，在浏览器 Worker 本地识别；默认 `chi_sim+eng`，其他语言按需；图片不上传、零 AI 调用 |
| 习惯补录 | `/habits`「补打卡」、月视图点日期 / 点圆点旁的 × | 直接读写 `habit_logs` | 昨天/前天/任意过去日期、防重复、二次确认、取消后全量重算统计 |

两者都用 `ReadableStream` 返回 NDJSON 进度（`progress / error / file`），前端 `lib/export/client.ts` 逐行解析并更新进度条，最后组装 Blob 下载。服务端一律 `createClient()`（cookie）+ `.eq('user_id', user.id)` + RLS，只能导出自己的数据；单次上限 **300 道 / 40 图 / 6MB**，超出给黄色提示。

### 11.2 新依赖（环境变量不变）

```bash
npm install docx@^9.1.1 jszip@^3.10.1 tesseract.js@^5.1.1 sharp@^0.33.5
```

两个导出路由都声明 `runtime = 'nodejs'`（sharp / docx 不能在 Edge 运行）。**没有新增任何环境变量**，`DASHSCOPE_CODING_API_KEY` 等保持第 3 节原样。

### 11.3 验证命令（Windows / macOS 相同）

```bash
npx tsc --noEmit
npm run build
node scripts/verify-export.mjs       # 7 项全 OK：WebP→PNG、docx 真内嵌、Anki 媒体包
node scripts/verify-image-arch.mjs   # v4 图片架构 46 项全 OK（无需凭据）
node scripts/migrate-images.mjs --dry-run   # v4 历史 Base64 迁移 dry-run（需 service_role）
node scripts/verify-migration.mjs    # 迁移后抽查 5 图 + 3 整题（需 service_role）
node scripts/healthcheck.mjs         # 只读自检
node scripts/healthcheck.mjs --ai    # 可选：Coding Plan 最小调用（消耗极小配额）
```

`supabase/selfcheck.sql` 在 Supabase SQL Editor 跑，前 9 行应为 `OK`。

**本地已真实跑过的结果**（`npm run start` + curl，dummy Supabase 值，非真实联调）：

```
POST /api/export/word  {"ids":[...]}  → 200 NDJSON {"type":"error","error":"请先登录后再导出"}
POST /api/export/anki  {"ids":[...]}  → 200 NDJSON {"type":"error","error":"请先登录后再导出"}
POST /api/export/word  {}             → 400 {"error":"参数不合法：请提供 ids 或筛选条件"}
POST /api/ai/organize  {"title":"x"}  → 401 {"error":"请先登录","code":"UNAUTHORIZED"}
```

只证明路由可运行、参数校验与登录拦截生效；**真实数据导出 / Anki 导入 / 本地 OCR 首次下载仍需按 `docs/08` 验收**。

### 11.4 明确的降级与限制

- **`.apkg 未实现，已用 CSV/TSV 替代`**：Anki 走「文本 + 媒体包」导入。字段映射（第1列→Front、第2列→Back、分隔符 Tab、勾 HTML、不忽略首行）与图片处理（`.media` 文件夹 / `collection.media`）写在 zip 内 `导入说明.txt`、`docs/05` 6.2、`docs/04` VI2。
- **Word 是真 `.docx`，不是 HTML 改后缀**；公式只保留文本、不渲染 KaTeX；图片随文件走。
- **本地 OCR 只输出纯文本、不生成 LaTeX**；首次下载约 20MB（引擎 3–5MB + 中英文约 16MB），缓存到浏览器 IndexedDB，之后可离线；弱网 30–60 秒，120 秒超时后原图保留、可手动录入；其他语言按需加载（每种 4–14MB）；**没有自托管语言包**，完全隔离公网 CDN 的内网环境不可用（已知限制）。
- **习惯补录**：全量拉取当前用户 `habit_logs` 重算，连续天数最多回溯 730 天，超过 5000 行需另建索引（未做分页）。
- **未真实联调**：没有 Supabase / Vercel / Coding Plan 凭据，没有在 Word / Anki / 真机浏览器实际打开过导出文件。逐项清单见 `docs/08-真实联调清单.md`，验收项见 `docs/04` VI 段。

### 11.5 AI 开关不受影响

这 4 项**都不在 `/api/ai/*` 下、都不读 Key**：总开关关闭或 Key 未配置时照常可用、零 API 调用、零费用。会调用 Coding Plan 的仍是那 5 个路由（organize / ocr / similar / schedule-parse / note-summary），第一行都是 `requireAi(...)`；`/api/ai/status` 是唯一只读例外，不触发任何 AI 请求。设置页新增的「OCR 识题设置」也明确标注不受总开关控制。

---

## 12. v4 图片架构与整题拍照上传

详细改造清单：[`docs/09-图片架构v4改造清单.md`](docs/09-图片架构v4改造清单.md) ｜ 迁移步骤：[`docs/03` V6](docs/03-部署步骤.md) ｜ 小白教学：[`docs/05` 第七部分](docs/05-使用与维护手册.md) ｜ 验收：[`docs/04` VII 段](docs/04-验收清单.md)。

### 12.1 架构铁律

```
拍照/相册/拖拽/粘贴
  → 浏览器压缩（最长边 1600 / WebP / 0.8，目标 200–500KB）+ canvas 生成 320px 缩略图
  → POST /api/images/upload（服务端校验登录、类型、≤8MB、数量、归属）
  → 上传私有桶 mistake-images，路径 <uid>/mistakes/<用途>/<实体id>/<uuid>.<ext>
  → 上传成功后才 INSERT mistake_images（只写路径 + 元数据；失败回滚文件）
  → 全部页面通过 signed URL 取图（列表用缩略图、详情用大图、打印/分享/AI OCR 同链路）
  → 本地原图包 zip 只是用户手动下载的离线副本，网页永不读本地文件
```

- **数据库零图片数据**：`mistake_images` / `attachments` / `ocr_jobs` 无 Base64、无 Blob、无 `bytea`；只有 `storage_path`（可选 `public_url`）+ 宽高/大小/用途/备份状态。
- **用途标记 `image_role`**：`original`（整题原图）/ `cropped`（手动裁剪）/ `inline`（富文本内嵌）/ `thumbnail`（缩略图）；`parent_image_id` + `crop_rect` 记录裁剪来源与坐标。
- **OCR 与原图独立**：`ocr_jobs.image_id` 指向原图；`applied_at` / `applied_field` 只在用户点「确认应用」后写；删改题干不影响原图。
- **图片级回收站** `deleted_images`：删图只登记、**Storage 文件保留**；彻底删除/清空回收站时由客户端 `storage.remove()`；失败写 `image_purge_failures`。
- **孤儿清理**：`list_orphan_images_v4()` 只读列出（排除登记表、回收站、富文本引用），用户勾选 + 二次确认才删。
- **分享页**：签名 URL 有效期 = `min(3600s, 分享链接剩余秒数)`，链接过期图片也不可访问。
- **私有桶 + RLS**：`foldername(name)[1] = auth.uid()`，用户只能访问自己目录；`service_role` 只出现在服务端分享路由与本地一次性迁移脚本，前端/日志/README 无真实密钥。

### 12.2 新增/改动文件

| 层 | 文件 |
| --- | --- |
| SQL | `supabase/schema.sql` PART IV（幂等）、`supabase/selfcheck-image.sql` |
| 前端压缩与上传 | `lib/images/compress.ts`、`lib/images/client.ts`、`lib/images/server.ts` |
| 服务端上传/迁移/导出 | `app/api/images/upload/route.ts`、`app/api/images/migrate-inline/route.ts`、`app/api/export/originals/route.ts` |
| 整题预览与裁剪 | `components/FullPageCaptureDialog.tsx`、`components/ImageCropper.tsx` |
| 富文本 Base64 治理 | `components/LegacyImageNotice.tsx`、`RichTextEditor` 的 `allowBase64:false`、`lib/data.ts` 的 `hydrateRichText/stripInjectedSrc` |
| 回收站/孤儿 | `components/ImageTrashPanel.tsx`、`lib/data.ts` 的 `deleted_images` 系列函数、`lib/data-v2.ts` 的 `purgeTrash` |
| 展示/打印 | `components/MistakeCard.tsx`（缩略图）、`components/PrintDocument.tsx`（整题原图默认打印）、`components/Providers.tsx` + `app/globals.css`（加载失败占位） |
| AI 取图 | `app/api/ai/ocr/route.ts`（`storagePath` + 归属校验 + 结构化输出）、`app/api/ai/organize/route.ts`（`storagePaths`） |
| 分享 | `app/api/share/[token]/route.ts`（TTL 与链接一致 + 富文本内嵌图签名） |
| 备份 | `app/api/backup/export/route.ts`（32 张表）、设置页「导出原图包」 |
| 脚本 | `scripts/migrate-images.mjs`、`verify-migration.mjs`、`verify-image-arch.mjs` |

### 12.3 AI 开关不受影响（重点）

整题上传的**自动 OCR 默认触发，但必须同时满足**：AI 总开关开 + OCR 子开关开 + `DASHSCOPE_CODING_API_KEY` 已配置 + `AI_BASE_URL` 已配置。前端 `ai.can('ocr')` 与服务端 `requireAi('ocr')` 双重校验，任一不满足 → 预计调用 0 次、不发任何 `/api/ai/*` 请求、零费用，整题原图照常上传保留，用户可用**本地 OCR** 或手动录入。

**没有新增独立 AI 开关**，复用现有 OCR 子开关与 `/api/ai/ocr` 路由；**没有新增/修改任何环境变量**（Coding Plan 配置、模型 ID、AI 开关全部照旧）。`/api/ai/status` 仍是唯一只读例外。

### 12.4 验证命令与本次执行结果

```bash
npx tsc --noEmit                    # 通过
npm run build                       # 通过
node scripts/verify-image-arch.mjs  # 46 项全 OK（无需凭据）
node scripts/verify-export.mjs      # 7 项全 OK（v3 回归）
```

迁移与真实抽查（需 `SUPABASE_SERVICE_ROLE_KEY`，仅本地一次）：

```bash
npm run migrate:images:dry          # 只统计
npm run migrate:images              # 幂等迁移，可重跑
npm run verify:migration            # 抽 5 张图 + 3 道整题错题
```

### 12.5 已知限制与降级（如实标注）

| 项 | 状态 |
| --- | --- |
| `.apkg` Anki 包 | **未实现，已用 CSV/TSV 替代**（v3 既有降级，本次未改） |
| Supabase Storage 图片变换 | **未使用**；前端 canvas 生成缩略图，额外占一份小图存储（每张约 5–20KB） |
| 公开 bucket | **未采用**；保持私有桶 + signed URL，分享过期即不可访问 |
| AI 自动从整卷切几何图 | **明确不做**；只支持用户手动框选裁剪 |
| 「原图包」内容 | 是**压缩后的展示图**（WebP 200–500KB），云端没有未压缩原文件；原始照片请自行留档 |
| AI 图形描述 | 标注「AI 描述，仅供参考」，**打印默认不打印**，不能替代原图 |
| 单次导出上限 | 300 道 / 500 张 / 60MB（原图包）；Word/Anki 仍是 300 道 / 40 图 / 6MB |
| 富文本历史 Base64 | 新图不会产生；旧图展示时提示「该图片存储方式需迁移」并提供一键迁移入口 |
| **真实联调** | **未真实联调**：未替你注册/部署，未在真机浏览器、Word、Anki 中打开导出文件。清单见 `docs/08`，升级步骤见 `docs/03` V6 |
