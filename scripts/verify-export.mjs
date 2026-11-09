#!/usr/bin/env node
/**
 * 导出链离线自检（不需要 Supabase / 不需要登录 / 不调用任何 AI）
 *
 * 验证的是「图片格式转换 → Word 真实内嵌 → Anki 媒体包」这条技术链：
 *   1) sharp 能把 WebP 转成 PNG（站点上传的图片就是 WebP）
 *   2) docx 生成的 .docx 里真的有 word/media/image1.png，且 document.xml 含 <w:drawing>（不是外链）
 *   3) JSZip 生成的 Anki 包里真的有 mistakes.tsv 与 mistakes.tsv.media/*.png
 *
 * ★ 边界：这是**依赖链自检**，不是端到端导出验证（真实错题数据仍需按 docs/08 阶段 V-C/V-D 在浏览器验）。
 * 运行：node scripts/verify-export.mjs
 */
import sharp from 'sharp'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, ImageRun } from 'docx'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'export-verify-'))
let failed = 0
const check = (ok, name, detail = '') => {
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

// ---- 1. WebP → PNG ----
const webp = await sharp({
  create: { width: 320, height: 160, channels: 3, background: { r: 235, g: 245, b: 255 } }
}).webp().toBuffer()
const png = await sharp(webp).png().toBuffer()
const meta = await sharp(png).metadata()
check(meta.format === 'png' && meta.width === 320 && meta.height === 160,
  'sharp 把 WebP 转成 PNG', `${meta.format} ${meta.width}x${meta.height}, ${png.byteLength} bytes`)

// ---- 2. Word 图片真实内嵌 ----
const doc = new Document({
  sections: [{
    children: [new Paragraph({
      children: [new ImageRun({
        data: Uint8Array.from(png),
        transformation: { width: meta.width, height: meta.height },
        type: 'png'
      })]
    })]
  }]
})
const docxBuf = await Packer.toBuffer(doc)
const docxZip = await JSZip.loadAsync(docxBuf)
const media = Object.keys(docxZip.files).filter((k) => k.startsWith('word/media/'))
const documentXml = await (docxZip.file('word/document.xml')?.async('string') || Promise.resolve(''))
check(media.length === 1, 'docx 内含图片文件', media.join(', '))
check(documentXml.includes('<w:drawing>') && documentXml.includes('r:embed'),
  'docx 用 drawing + r:embed 内嵌（不是外部链接）')
// 注意：document.xml 本身就含 http://schemas.openxmlformats.org 命名空间，
// 不能靠「有没有 http」判断外链；要看 rels 里有没有 TargetMode="External"。
const relsXml = await (docxZip.file('word/_rels/document.xml.rels')?.async('string') || Promise.resolve(''))
check(!documentXml.includes('r:link') && !relsXml.includes('TargetMode="External"'),
  'docx 里没有外链图片（rels 无 TargetMode="External"）')
const wordPath = join(out, 'word-image-demo.docx')
writeFileSync(wordPath, docxBuf)

// ---- 3. Anki 媒体包 ----
const anki = new JSZip()
const front = '<b>第 1 题 · 示例</b><br>题干文本<br><img src="m_demo_1.png">'
const back = '<b>答案</b><br>x = 2<br><br><b>知识点</b>：二次函数'
anki.file('mistakes.tsv', `${front}\t${back.replace(/\n/g, ' ')}`.replace(/[\t\r\n]+/g, '\t'))
anki.file('mistakes.tsv.media/m_demo_1.png', png)
anki.file('导入说明.txt', '示例')
const ankiBuf = await anki.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
const ankiZip = await JSZip.loadAsync(ankiBuf)
const names = Object.keys(ankiZip.files)
check(names.some((n) => n === 'mistakes.tsv'), 'Anki 包含 mistakes.tsv')
check(names.some((n) => n.startsWith('mistakes.tsv.media/') && n.endsWith('.png')), 'Anki 包含同名 .media 图片')
const tsv = await (ankiZip.file('mistakes.tsv')?.async('string') || Promise.resolve(''))
check(tsv.includes('<img src="m_demo_1.png">') && tsv.split('\t').length === 2,
  'TSV 是两列且含图片 HTML 引用')
const ankiPath = join(out, 'anki-demo.zip')
writeFileSync(ankiPath, ankiBuf)

console.log('\n生成的演示文件（在系统临时目录，不污染项目）：')
console.log('  ' + wordPath)
console.log('  ' + ankiPath)
console.log('\n汇总：' + (failed ? `${failed} 项 FAIL` : '全部 OK') + '。想要真正验收，请按 docs/08 阶段 V-C / V-D 在浏览器里导出并用 Word / Anki 打开。')
process.exit(failed ? 1 : 0)
