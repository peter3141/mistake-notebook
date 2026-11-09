'use client'

import { MASTERY_LABEL, VARIANT_LABEL, type Mistake, type PrintOptions, type PrintVariant } from '@/types'
import { fmtDate, renderMath } from '@/lib/utils'

/** 唯一的打印渲染出口：屏幕预览与 @media print 共用同一份 DOM，保证「所见即所打」 */
export function PrintDocument({
  mistakes, options, variant, title = '错题练习卷', aiEnabled = false
}: {
  mistakes: Mistake[]
  options: PrintOptions
  variant: PrintVariant
  title?: string
  aiEnabled?: boolean
}) {
  const showAnswer = options.showAnswer && (variant === 'answer' || variant === 'cause' || variant === 'review')
  const showAnalysis = options.showAnalysis && variant !== 'student'
  const lines = variant === 'student' ? 6 : 3
  // v4：AI 图形描述默认不打印；勾选后仍强制保留「AI 描述，仅供参考」标注
  const html = (h: string | null | undefined) => {
    let s = String(h || '')
    if (!options.showAiFigureDescription) {
      s = s.replace(/<p[^>]*>\s*<em>[\s\S]{0,800}?AI 描述，仅供参考[\s\S]{0,800}?<\/em>\s*<\/p>/gi, '')
    }
    return renderMath(s)
  }
  const groups = (m: Mistake) => {
    const imgs = m.images || []
    return {
      originals: imgs.filter((i) => i.image_role === 'original'),
      cropped: imgs.filter((i) => i.image_role === 'cropped'),
      others: imgs.filter((i) => i.image_role !== 'original' && i.image_role !== 'cropped' && i.image_role !== 'thumbnail')
    }
  }

  return (
    <div className="print-sheet mx-auto max-w-[210mm] bg-white p-4 md:p-8">
      {options.showHeader && (
        <div className="print-header">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{title}</h1>
              <p className="mt-1 text-xs text-slate-500">{VARIANT_LABEL[variant]} · 共 {mistakes.length} 题 · 生成日期 {fmtDate(new Date().toISOString())}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              姓名：____________　班级：____________　得分：____________
            </div>
          </div>
        </div>
      )}

      {mistakes.length === 0 && <p className="py-10 text-center text-sm text-slate-400">没有可打印的错题，请先到列表选择或调整筛选条件。</p>}

      {mistakes.map((m, idx) => (
        <section key={m.id} className="print-block mb-3 rounded-lg border border-slate-200 p-3 md:p-4">
          <div className="print-avoid-break flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold leading-relaxed text-slate-900">
              {idx + 1}. {m.title || '（无标题）'}
            </h2>
            <div className="shrink-0 text-[10px] text-slate-400">
              {m.subject?.name || '未分类'} · {'★'.repeat(m.difficulty)} · {fmtDate(m.mistake_date)}
            </div>
          </div>

          {m.content && (
            <div className="tiptap mt-2 text-[13px] leading-relaxed text-slate-800"
              dangerouslySetInnerHTML={{ __html: html(m.content) }} />
          )}

          {/* v4：打印整题时默认打印「整题原图」；裁剪图按用户勾选；缩略图不打印。
               全部走 Storage 签名 URL，不读本地文件；失败由全局占位提示兜底。 */}
          {options.showImages && (() => {
            const g = groups(m)
            return (
              <>
                {g.originals.length > 0 && (
                  <div className="full-page-original mt-2">
                    <div className="mb-1 text-[11px] font-semibold text-emerald-700">整题原图（默认打印）</div>
                    {g.originals.map((img) => img.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={img.id} src={img.signedUrl} alt="整题原图" loading="lazy"
                        className="mb-1 max-h-[120mm] max-w-full rounded border border-emerald-200 object-contain" />
                    ))}
                  </div>
                )}
                {g.others.length > 0 && (
                  <div className="mistake-image-block mt-2 flex flex-wrap gap-2">
                    {g.others.map((img) => img.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={img.id} src={img.signedUrl} alt="题目图片" loading="lazy"
                        className="max-h-[70mm] max-w-full rounded border border-slate-200 object-contain" />
                    ))}
                  </div>
                )}
                {options.showCroppedImages && g.cropped.length > 0 && (
                  <div className="mistake-image-block mt-2">
                    <div className="mb-1 text-[11px] text-slate-500">手动裁剪图</div>
                    <div className="flex flex-wrap gap-2">
                      {g.cropped.map((img) => img.signedUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={img.id} src={img.signedUrl} alt="手动裁剪图" loading="lazy"
                          className="max-h-[70mm] max-w-full rounded border border-slate-200 object-contain" />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {/* 学生版留白答题区 */}
          {variant === 'student' && (
            <div className="mt-2 space-y-2">
              {Array.from({ length: lines }).map((_, i) => <div key={i} className="h-4 border-b border-dashed border-slate-300" />)}
            </div>
          )}

          {showAnswer && m.answer && (
            <div className="mt-2 text-[13px]"><b>答案：</b><span className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: html(m.answer) }} /></div>
          )}
          {showAnalysis && m.analysis && (
            <div className="mt-1 text-[13px]"><b>解析：</b><span className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: html(m.analysis) }} /></div>
          )}

          {options.showKnowledge && !!m.knowledge_points?.length && (
            <div className="mt-2 text-[11px] text-slate-600">知识点：{m.knowledge_points.join('、')}</div>
          )}
          {options.showCause && variant !== 'student' && (
            <div className="mt-1 text-[11px] text-slate-600">错因：{m.cause}　掌握状态：{MASTERY_LABEL[m.mastery]}</div>
          )}
          {options.showTags && !!m.tags?.length && (
            <div className="mt-1 text-[11px] text-slate-600">标签：{m.tags.map((t) => `#${t.name}`).join('  ')}</div>
          )}
          {options.showReviewAdvice && (
            <div className="mt-1 text-[11px] text-slate-600">
              复习建议：下次复习 {fmtDate(m.next_review_at)}，已复习 {m.review_count} 次 / 错误 {m.error_count} 次
            </div>
          )}

          {/* 关闭 AI 时明确提示，不报错、不留白 */}
          {variant === 'review' && (
            <div className="mt-2 rounded bg-slate-50 p-2 text-[11px] text-slate-500">
              相似题建议：{aiEnabled ? '（AI 生成内容请在详情页查看，均需核对）' : 'AI功能已关闭'}
            </div>
          )}
        </section>
      ))}

      <div className="mt-4 text-center text-[10px] text-slate-400">— 本页由「个人综合管理网站 · 错题本模块」生成 · 浏览器打印可另存为 PDF —</div>
    </div>
  )
}
