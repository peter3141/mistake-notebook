import type { Metadata, Viewport } from 'next'
import 'katex/dist/katex.min.css'
import './globals.css'

export const metadata: Metadata = {
  title: '个人综合管理网站 · PersonalHub',
  description: '错题本 / 日程 / 待办 / 笔记 / 习惯打卡 / 番茄钟 / 目标管理，云端同步，手机电脑都能用',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '个人综合管理' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' }
}

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 5, themeColor: '#4f46e5'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full">{children}</body>
    </html>
  )
}
