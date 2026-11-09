import { z } from 'zod'
import JSZip from 'jszip'
import { createClient } from '@/lib/supabase/server'
import { ndjsonResponse } from '@/lib/export/stream'
import { embedImages, loadMistakesForExport, MAX_ROWS } from '@/lib/export/mistakes'
import { ankiHtml, htmlToPlain, safeFileName, tsvCell } from '@/lib/export/html'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  ids: z.array(z.string().max(80)).max(MAX_ROWS).optional(),
  filter: z.record(z.any()).optional()
}).refine((v) => (v.ids && v.ids.length) || v.filter, { message: '请提供 ids 或筛选条件' })

function csvCell(s: string) {
  return '"' + String(s ?? '').replace(/"/g, '""') + '"'
}

/**
 * POST /api/export/anki
 * .apkg 未实现（需要构造 Anki 的 SQLite collection.anki2 + media 映射表），
 * 这里输出 Anki 桌面版可直接「文件 → 导入」的 TSV / CSV + 媒体包 zip。
 * 正面：题干 + 图片；背面：答案 + 解析 + 知识点 + 错因 + 标签 + 科目难度。
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: '参数不合法：' + parsed.error.issues[0]?.message }, { status: 400 })

  return ndjsonResponse(async (emit) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { emit({ type: 'error', error: '请先登录后再导出' }); return }

    emit({ type: 'progress', stage: '正在读取错题', done: 0, total: MAX_ROWS })
    const { rows, truncated } = await loadMistakesForExport(supabase as any, user.id, parsed.data)
    if (!rows.length) { emit({ type: 'error', error: '没有符合条件的错题（回收站中的错题不会导出）' }); return }
    emit({ type: 'progress', stage: `已读取 ${rows.length} 道，准备图片`, done: 1, total: rows.length + 2 })

    const { warnings } = await embedImages(supabase as any, user.id, rows, (done, total) => {
      emit({ type: 'progress', stage: `正在打包图片 ${done}/${total}`, done: 1 + done, total: rows.length + 2 })
    })
    if (truncated) warnings.unshift(`结果超过 ${MAX_ROWS} 道，本次只导出前 ${MAX_ROWS} 道，请缩小筛选范围后分批导出。`)
    emit({ type: 'progress', stage: '正在生成 Anki 导入包', done: rows.length + 1, total: rows.length + 2 })

    const zip = new JSZip()
    const tsv: string[] = []
    const csv: string[] = []

    rows.forEach((m, idx) => {
      const imgs = m.embedded.map((im) => `<img src="${im.fileName}">`).join('<br>')
      const front = [
        `<b>第 ${idx + 1} 题 · ${ankiHtml(m.title)}</b>`,
        ankiHtml(htmlToPlain(m.content) || '（无文字题干，见图片）'),
        imgs
      ].filter(Boolean).join('<br>')
      const back = [
        `<b>答案</b><br>${ankiHtml(htmlToPlain(m.answer) || '—')}`,
        `<b>解析 / 错因复盘</b><br>${ankiHtml(htmlToPlain(m.analysis) || '—')}`,
        `<b>知识点</b>：${ankiHtml((m.knowledge_points || []).join('、') || '—')}`,
        `<b>错因</b>：${ankiHtml(m.cause || '—')}　<b>难度</b>：${m.difficulty ? '★'.repeat(m.difficulty) : '—'}`,
        `<b>标签</b>：${ankiHtml(m.tags.join('、') || '—')}`,
        `<b>科目</b>：${ankiHtml(m.subjectName)}　<b>错题本</b>：${ankiHtml(m.bookName)}　<b>日期</b>：${ankiHtml(m.mistake_date || '—')}`
      ].join('<br><br>')

      tsv.push(`${tsvCell(front)}\t${tsvCell(back)}`)
      csv.push(`${csvCell(front)},${csvCell(back)}`)
      // Anki 约定的自动媒体目录：与导入文件同名 + .media
      for (const im of m.embedded) {
        zip.file(`mistakes.tsv.media/${im.fileName}`, im.base64, { base64: true })
      }
    })

    // TSV 不加 BOM（Anki 会把 BOM 当成第一张卡片正面的一部分）；CSV 加 BOM 方便 Windows 识别 UTF-8
    zip.file('mistakes.tsv', tsv.join('\n'))
    zip.file('mistakes.csv', '\uFEFF' + csv.join('\r\n'))
    zip.file('导入说明.txt', '\uFEFF' + buildReadme(rows.length, rows.reduce((a, m) => a + m.embedded.length, 0)))

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const name = `错题本-Anki-${safeFileName(rows.length === 1 ? rows[0].title : `${rows.length}题`)}-${new Date().toISOString().slice(0, 10)}.zip`
    emit({ type: 'file', name, mime: 'application/zip', base64: buffer.toString('base64'), warnings })
    emit({ type: 'progress', stage: '已完成', done: rows.length + 2, total: rows.length + 2 })
  })
}

function buildReadme(count: number, images: number) {
  return [
    'Anki 卡片导入说明（本包不是 .apkg，是 Anki 可直接导入的文本 + 媒体包）',
    '',
    `本次导出：${count} 张卡片，${images} 张图片。`,
    '卡片结构：正面 = 题干 + 图片；背面 = 答案 + 解析 + 知识点 + 错因 + 标签 + 科目难度。',
    '',
    '【第 1 步】把本 zip 完整解压到一个文件夹，不要只把 mistakes.tsv 拖出来。',
    '  解压后应同时看到：mistakes.tsv、mistakes.tsv.media 文件夹、mistakes.csv、导入说明.txt。',
    '',
    '【第 2 步】打开 Anki 桌面版 → 顶部菜单「文件」→「导入」→ 选择 mistakes.tsv。',
    '',
    '【第 3 步】在导入对话框里逐项设置：',
    '  · 笔记类型：Basic（只有 Front / Back 两个字段，最省事）',
    '  · 牌组：新建一个「错题本」或选择已有牌组',
    '  · 字段分隔符：Tab（制表符）',
    '  · 字段对应：第 1 列 → Front，第 2 列 → Back',
    '  · 勾选「允许在字段中使用 HTML」（一定要勾，否则图片和换行会变成文字）',
    '  · 不要勾「忽略第一行」（本文件没有表头，第一行就是第一张卡片）',
    '  · 重复处理按需选择「更新已有笔记」或「忽略」',
    '',
    '【第 4 步】点「导入」。Anki 会自动从同目录的 mistakes.tsv.media 文件夹里带走图片。',
    '  如果导入后卡片显示碎图，说明媒体没被自动复制，改用第 5 步。',
    '',
    '【第 5 步（备用）】手动放图片：',
    '  · Windows：把 mistakes.tsv.media 里的所有文件复制到',
    '      %APPDATA%\\Anki2\\<你的账户名>\\collection.media\\',
    '  · macOS：复制到',
    '      ~/Library/Application Support/Anki2/<你的账户名>/collection.media/',
    '  · 也可在 Anki 里点「工具 → 检查媒体」，先确认媒体库位置。',
    '  放好后重启 Anki，卡片里的 <img src="..."> 就能找到图片。',
    '',
    '【如果 Tab 导入不对】改用 mistakes.csv：分隔符选「逗号」，其余设置相同。',
    '',
    '【注意】图片已转成 PNG / JPEG 随包提供，导入后不再依赖本网站，也不依赖网络。',
    '【注意】公式以文字形式保留（Anki 不渲染本站的 KaTeX），需要公式请手动改成 $$...$$。',
    '【注意】本包只包含你自己的错题（服务端按登录账号 + RLS 过滤），可放心分享给自己的 Anki。'
  ].join('\n')
}
