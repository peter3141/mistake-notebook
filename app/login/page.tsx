'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Mail, Lock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const site = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || '')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg('')
    const supabase = createClient()
    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email, options: { emailRedirectTo: `${site}/api/auth/callback` }
        })
        if (error) throw error
        setMsg('魔法链接已发送，请打开邮箱点击链接登录（记得把回调域名加入 Supabase Redirect URLs）。')
      } else if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('注册成功！若 Supabase 开启了邮箱验证，请先去邮箱点确认链接，再回来登录。')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push('/'); router.refresh()
      }
    } catch (e: any) {
      setMsg(`操作失败：${e?.message || '请检查邮箱/密码与 Supabase 配置'}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-bold text-brand-700">
          <BookOpen size={26} /> 个人综合管理
        </div>
        <p className="-mt-4 mb-6 text-center text-xs text-slate-500">错题 · 日程 · 待办 · 笔记 · 习惯 · 专注 · 目标</p>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-slate-800">{isSignUp ? '注册账号' : '登录'}</h1>
          <p className="muted mt-1">数据保存在云端，手机和电脑登录同一账号即可同步</p>

          <div className="mt-5 flex rounded-lg bg-slate-100 p-1 text-sm">
            <button className={`flex-1 rounded-md py-1.5 ${mode === 'password' ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`} onClick={() => setMode('password')}>邮箱 + 密码</button>
            <button className={`flex-1 rounded-md py-1.5 ${mode === 'magic' ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`} onClick={() => setMode('magic')}>魔法链接</button>
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="label">邮箱</label>
              <div className="relative"><Mail size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input className="input pl-9" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
            </div>
            {mode === 'password' && (
              <div>
                <label className="label">密码（至少 6 位）</label>
                <div className="relative"><Lock size={16} className="absolute left-3 top-2.5 text-slate-400" />
                  <input className="input pl-9" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
                </div>
              </div>
            )}
            <button className="btn-primary w-full" disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {mode === 'magic' ? '发送魔法链接' : isSignUp ? '注册' : '登录'}
            </button>
          </form>

          {mode === 'password' && (
            <button className="mt-4 w-full text-center text-sm text-brand-600 hover:underline" onClick={() => { setIsSignUp(!isSignUp); setMsg('') }}>
              {isSignUp ? '已有账号？去登录' : '还没有账号？点此注册'}
            </button>
          )}

          {msg && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">{msg}</div>}
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">AI 功能默认关闭 · 未配置 Key 也不影响手动录题、复习与打印</p>
      </div>
    </div>
  )
}
