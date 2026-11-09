'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TiptapImage from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Bold, Italic, Heading2, List, ListOrdered, Quote, Code2, Table2, Sigma, Link2, Undo2, Redo2 } from 'lucide-react'
import { useEffect } from 'react'

export function RichTextEditor({
  value, onChange, placeholder = '输入题目正文… 公式用 $E=mc^2$ 或 $$\\frac{a}{b}$$'
}: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      // v4：禁止把图片数据以 Base64 写进富文本。要插图请用「插入云端图片」（只存 storage_path）
      TiptapImage.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: 'tiptap px-3 py-2' } }
  })

  useEffect(() => {
    if (editor && value !== undefined && value !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(value || '', false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) return <div className="min-h-[160px] animate-pulse rounded-lg bg-slate-50" />

  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
        公式写法：行内 <code>$x^2$</code>，独立一行 <code>$$\\frac{'{a}'}{'{b}'}$$</code>；展示与打印时自动渲染
      </div>
    </div>
  )
}

function Btn({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={`rounded p-1.5 text-slate-600 hover:bg-slate-100 ${active ? 'bg-brand-50 text-brand-700' : ''}`}>
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const insertFormula = () => {
    const tex = window.prompt('输入 LaTeX 公式（不含 $ 符号），例如 \\frac{1}{2}')
    if (tex) editor.chain().focus().insertContent(` $${tex}$ `).run()
  }
  const insertLink = () => {
    const url = window.prompt('输入链接地址（https://…）')
    if (url) editor.chain().focus().setLink({ href: url }).run()
  }
  return (
    <div className="no-print flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
      <Btn title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
      <Btn title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
      <Btn title="标题" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></Btn>
      <Btn title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Btn>
      <Btn title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
      <Btn title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></Btn>
      <Btn title="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 size={15} /></Btn>
      <Btn title="插入 3×3 表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={15} /></Btn>
      <Btn title="插入公式" onClick={insertFormula}><Sigma size={15} /></Btn>
      <Btn title="插入链接" onClick={insertLink}><Link2 size={15} /></Btn>
      <span className="mx-1 h-4 w-px bg-slate-200" />
      <Btn title="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></Btn>
      <Btn title="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></Btn>
    </div>
  )
}
