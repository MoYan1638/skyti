/**
 * SkyTi Service Worker — 最小实现
 * 仅注册 fetch 处理器满足 PWA 安装条件，请求全部透传网络（不做离线缓存，
 * 避免题库更新后用户拿到旧版本）。
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(clients.claim()))
self.addEventListener('fetch', () => {})
