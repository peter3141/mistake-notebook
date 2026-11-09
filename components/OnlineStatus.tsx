'use client'

import { useEffect, useState } from 'react'
import { WifiOff, Wifi } from 'lucide-react'

/** 离线状态：只读缓存可用，禁止静默覆盖云端数据；恢复网络后提示可同步 */
export function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

export function OnlineBanner() {
  const online = useOnline()
  const [justBack, setJustBack] = useState(false)
  useEffect(() => {
    if (!online) return
    const t = setTimeout(() => setJustBack(false), 6000)
    return () => clearTimeout(t)
  }, [online])
  useEffect(() => {
    if (online) setJustBack(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])
  if (online && !justBack) return null
  return (
    <div className={`no-print fixed left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium shadow-lg ${online ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {online ? '网络已恢复，可以继续同步数据' : '当前离线：只能查看已缓存内容，暂时无法保存/上传'}
    </div>
  )
}

/** 表单保存按钮统一用它：离线时禁用，避免覆盖云端 */
export function offlineGuard(online: boolean, toast: (s: string, t?: 'err' | 'ok' | 'info') => void) {
  if (!online) { toast('当前离线，请恢复网络后再保存，避免覆盖云端数据', 'err'); return false }
  return true
}
