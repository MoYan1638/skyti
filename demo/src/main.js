/**
 * SkyTi — 主入口
 * （开始按钮事件统一在 quiz.js 中绑定，避免重复触发；
 *   此处仍需 import quiz.js 以加载答题流程模块）
 */
import './quiz.js'
import './feedback.js'

// PWA：注册最小 service worker（仅满足安装条件，不做缓存）
// 用 BASE_URL 拼绝对路径：三端合并后页面在 /standard/ /demo/ /pro/ 子路径下，
// 相对路径遇到不带斜杠的 URL（如 /standard）会解析到错误位置
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
