'use client'

import { useEffect } from 'react'
import { ToastProvider } from './Toast'
import { AiProvider } from './AiProvider'
import { OnlineBanner } from './OnlineStatus'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA 可选，失败不影响使用 */ })
    }
    // v4：任何 Storage 图片加载失败时显示占位提示，绝不白屏 / 绝不显示破图后什么都不说
    const onImgError = (e: Event) => {
      const img = e.target as HTMLImageElement
      if (!img || img.tagName !== 'IMG' || img.dataset.fallbackApplied) return
      img.dataset.fallbackApplied = '1'
      const box = document.createElement('div')
      box.className = 'img-load-fallback'
      box.textContent = '图片加载失败，请检查网络或存储配置'
      img.style.display = 'none'
      img.parentElement?.insertBefore(box, img.nextSibling)
    }
    document.addEventListener('error', onImgError, true)
    return () => document.removeEventListener('error', onImgError, true)
  }, [])
  return (
    <ToastProvider>
      <AiProvider>
        <OnlineBanner />
        {children}
      </AiProvider>
    </ToastProvider>
  )
}
