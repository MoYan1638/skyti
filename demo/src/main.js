/**
 * SkyTi — 主入口
 * （开始按钮事件统一在 quiz.js 中绑定，避免重复触发；
 *   此处仍需 import quiz.js 以加载答题流程模块）
 */
import './quiz.js'
import './feedback.js'

// PWA：注册最小 service worker（仅满足安装条件，不做缓存）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  })
}
