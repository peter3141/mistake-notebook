/* 个人综合管理 PWA：基础离线只读缓存（v2）
   规则：只缓存用户已经访问过的 GET 页面与静态资源；
        ★ 不缓存 /api/*（含全部 AI 路由），不缓存任何写操作；
        ★ 离线时前端会禁用保存，禁止静默覆盖云端数据，恢复网络后提示同步。 */
const CACHE = 'personalhub-v2'
const PRECACHE = ['/', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
      return res
    })))
    return
  }
  // 页面：网络优先，成功即写入缓存；断网时回退到已看过的页面
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
      return res
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')).then((r) => r || Response.error()))
  )
})
