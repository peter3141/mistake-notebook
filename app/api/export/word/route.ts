import { z } from 'zod'
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun,
  Packer, PageBreak, Paragraph, TextRun
} from 'docx'
import { createClient } from '@/lib/supabase/server'
import { ndjsonResponse } from '@/lib/export/stream'
import { embedImages, loadMistakesForExport, MAX_ROWS } from '@/lib/export/mistakes'
import { fitSize } from '@/lib/export/image'
import { htmlToLines, safeFileName } from '@/lib/export/html'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  ids: z.array(z.string().max(80)).max(MAX_ROWS).optional(),
  filter: z.record(z.any()).optional()
}).refine((v) => (v.ids && v.ids.length) || v.filter, { message: '请提供 ids 或筛选条件' })

/** 生成 Word 文档用的小工具 */
const p = (text: string, bold = false, size = 22) =>
  new Paragraph({ children: [new TextRun({ text, bold, size, font: 'Microsoft YaHei' })], spacing: { after: 80 } })

const lines = (html: string) => htmlToLines(html).map((l) => p(l))

function divider() {
  return new Paragraph({
    children: [new TextRun({ text: '', size: 2 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD', space: 1 } },
    spacing: { before: 160, after: 160 }
  })
}

/**
 * POST /api/export/word
 * 单题 / 选中多题 / 按当前筛选结果 → 一个 .docx 文件。
 * 图片以 Base64 真实嵌入 word/media/，不是链接；文件换电脑、断网都能正常显示。
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
      emit({ type: 'progress', stage: `正在内嵌图片 ${done}/${total}`, done: 1 + done, total: rows.length + 2 })
    })
    if (truncated) warnings.unshift(`结果超过 ${MAX_ROWS} 道，本次只导出前 ${MAX_ROWS} 道，请缩小筛选范围后分批导出。`)
    emit({ type: 'progress', stage: '正在生成 Word 文档', done: rows.length + 1, total: rows.length + 2 })

    const children: Paragraph[] = []
    children.push(new Paragraph({
      children: [new TextRun({ text: '个人错题本 · Word 导出', bold: true, size: 36, font: 'Microsoft YaHei' })],
      heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 160 }
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `导出时间：${new Date().toLocaleString('zh-CN')}　共 ${rows.length} 道　A4 排版`, size: 18, color: '777777' })],
      alignment: AlignmentType.CENTER, spacing: { after: 120 }
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: '说明：图片已真实嵌入本文件（不是网络链接），换电脑、断网打开都不会丢图；公式以文本形式保留。', size: 18, color: '777777' })],
      alignment: AlignmentType.CENTER, spacing: { after: 240 }
    }))

    rows.forEach((m, idx) => {
      if (idx > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
      children.push(new Paragraph({
        children: [new TextRun({ text: `第 ${idx + 1} 题 · ${m.title}`, bold: true, size: 28, font: 'Microsoft YaHei' })],
        heading: HeadingLevel.HEADING_1, spacing: { before: 120, after: 140 }
      }))
      children.push(p(
        `科目：${m.subjectName}　错题本：${m.bookName}　错因：${m.cause || '—'}　难度：${m.difficulty ? '★'.repeat(m.difficulty) : '—'}`, false, 19))
      children.push(p(
        `错题日期：${m.mistake_date || '—'}　来源：${m.source || '—'}　知识点：${(m.knowledge_points || []).join('、') || '—'}　标签：${m.tags.join('、') || '—'}`, false, 19))

      children.push(p('【题目】', true, 22))
      children.push(...(lines(m.content).length ? lines(m.content) : [p('（无文字题干）')]))
      for (const img of m.embedded) {
        const size = fitSize(img.width, img.height)
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 100 },
          children: [new ImageRun({
            data: Uint8Array.from(Buffer.from(img.base64, 'base64')),
            transformation: { width: size.width, height: size.height },
            type: img.ext === 'jpg' ? 'jpg' : 'png'
          } as any)]
        }))
      }
      children.push(p('【答案】', true, 22))
      children.push(...(lines(m.answer).length ? lines(m.answer) : [p('—')]))
      children.push(p('【解析 / 错因复盘】', true, 22))
      children.push(...(lines(m.analysis).length ? lines(m.analysis) : [p('—')]))
      children.push(divider())
    })

    const doc = new Document({
      creator: '个人综合管理网站',
      title: '错题导出',
      description: '错题本 Word 导出（图片已内嵌）',
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children: children as any
      }]
    })
    const buffer = await Packer.toBuffer(doc)
    const name = `错题本-Word-${safeFileName(rows.length === 1 ? rows[0].title : `${rows.length}题`)}-${new Date().toISOString().slice(0, 10)}.docx`
    emit({
      type: 'file', name,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      base64: buffer.toString('base64'), warnings
    })
    emit({ type: 'progress', stage: '已完成', done: rows.length + 2, total: rows.length + 2 })
  })
}
