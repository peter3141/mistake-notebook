'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MistakeForm } from '@/components/MistakeForm'

export default function NewMistakePage() {
  return (
    <div>
      <div className="no-print mb-4 flex items-center gap-3">
        <Link href="/mistakes" className="btn-ghost"><ArrowLeft size={16} /> 返回</Link>
        <div>
          <h1 className="text-xl font-bold text-slate-800">新建错题</h1>
          <p className="muted">支持拍照、多图、公式、表格；内容自动存草稿，关闭页面也不会丢</p>
        </div>
      </div>
      <MistakeForm />
    </div>
  )
}
