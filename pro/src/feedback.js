/**
 * SkyTi — 意见反馈（匿名，合并进同一条结果记录）
 * 首页 + 结果页入口，弹窗提交纯文字建议。
 * 反馈内容通过 report.js 的 attachFeedback 写入本条结果记录的 feedback 字段，
 * 未作答时提交的反馈会暂存，等下次出结果时一起入库。
 * 只收集反馈文字，不收集任何个人信息。
 */
import config from './data/config.json' with { type: 'json' }
import { attachFeedback } from './report.js'

const MAX_LEN = 200

/* ─── 样式 ─── */
const css = `
.fb-entry{background:none;border:none;color:#8BA4CC;font-size:13px;cursor:pointer;padding:6px 10px;opacity:.75;transition:.2s}
.fb-entry:hover{color:#FFD966;opacity:1}
.fb-entry.fb-result{font-size:14px;padding:10px 16px;border:1px solid rgba(126,200,227,.35);border-radius:22px}
.fb-overlay{position:fixed;inset:0;background:rgba(4,8,18,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999;opacity:0;transition:opacity .2s}
.fb-overlay.show{opacity:1}
.fb-modal{width:min(92vw,400px);background:linear-gradient(165deg,#0d1f42,#060c1a);border:1px solid rgba(255,217,102,.3);border-radius:16px;padding:22px;transform:translateY(14px);transition:transform .2s}
.fb-overlay.show .fb-modal{transform:none}
.fb-title{color:#FFD966;font-weight:bold;font-size:17px;text-align:center;margin-bottom:6px}
.fb-sub{color:#8BA4CC;font-size:12px;text-align:center;margin-bottom:14px}
.fb-textarea{width:100%;height:110px;resize:none;background:rgba(6,12,26,.8);border:1px solid rgba(126,200,227,.3);border-radius:10px;color:#fff;font-size:14px;padding:10px 12px;outline:none;box-sizing:border-box}
.fb-textarea:focus{border-color:#FFD966}
.fb-count{text-align:right;color:#5a6f95;font-size:11px;margin:4px 2px 10px}
.fb-actions{display:flex;gap:10px}
.fb-btn{flex:1;padding:10px 0;border:none;border-radius:20px;font-size:14px;font-weight:bold;cursor:pointer}
.fb-send{background:linear-gradient(135deg,#FFD966,#f5b942);color:#1a1405}
.fb-cancel{background:transparent;color:#7EC8E3;border:1px solid rgba(126,200,227,.4)}
`
const style = document.createElement('style')
style.textContent = css
document.head.appendChild(style)

/* ─── 弹窗 ─── */
let overlay = null
function openFeedback() {
  if (overlay) return
  overlay = document.createElement('div')
  overlay.className = 'fb-overlay'
  overlay.innerHTML = `
    <div class="fb-modal">
      <div class="fb-title">💬 意见反馈</div>
      <div class="fb-sub">题目、结果、界面，哪里不对劲尽管说（匿名）</div>
      <textarea class="fb-textarea" maxlength="${MAX_LEN}" placeholder="写下你的建议…"></textarea>
      <div class="fb-count">0 / ${MAX_LEN}</div>
      <div class="fb-actions">
        <button class="fb-btn fb-cancel">取消</button>
        <button class="fb-btn fb-send">✨ 发送</button>
      </div>
    </div>`
  const ta = overlay.querySelector('.fb-textarea')
  const count = overlay.querySelector('.fb-count')
  ta.addEventListener('input', () => { count.textContent = `${ta.value.length} / ${MAX_LEN}` })
  overlay.addEventListener('click', e => { if (e.target === overlay) closeFeedback() })
  overlay.querySelector('.fb-cancel').onclick = closeFeedback
  overlay.querySelector('.fb-send').onclick = () => {
    const text = ta.value.trim()
    if (!text) { ta.focus(); return }
    attachFeedback(text.slice(0, MAX_LEN))
    closeFeedback()
    showSubmitted(text)
    toast('感谢反馈，每一条墨言都会看 ✨')
  }
  document.body.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('show'))
}

/** 提交后把反馈内容展示在结果页末尾（未提交则保持隐藏） */
function showSubmitted(text) {
  const el = document.getElementById('result-fb')
  if (!el) return
  el.innerHTML = `<div class="result-fb-title">📝 你的反馈已收到</div><div class="result-fb-text"></div>`
  el.querySelector('.result-fb-text').textContent = text
  el.style.display = 'block'
}
/** 每次重新渲染结果时重置（由 quiz.js 调用） */
export function resetFeedbackDisplay() {
  const el = document.getElementById('result-fb')
  if (el) { el.style.display = 'none'; el.innerHTML = '' }
}
function closeFeedback() {
  if (!overlay) return
  overlay.classList.remove('show')
  const el = overlay
  setTimeout(() => el.remove(), 200)
  overlay = null
}

function toast(msg) {
  const t = document.createElement('div')
  t.className = 'copied-toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}

/* ─── 入口 ─── */
function addEntry(parent, cls) {
  if (!parent) return
  const b = document.createElement('button')
  b.className = `fb-entry ${cls}`
  b.textContent = '💬 意见反馈'
  b.onclick = openFeedback
  parent.appendChild(b)
}
// 首页：出品方信息旁
addEntry(document.querySelector('.intro-card'), '')
// 结果页：操作按钮区
addEntry(document.querySelector('#page-result .result-actions'), 'fb-result')
// 结果页末尾：反馈展示区（未提交时隐藏）
const resultCard = document.querySelector('#page-result .result-card')
if (resultCard && !document.getElementById('result-fb')) {
  const fb = document.createElement('div')
  fb.id = 'result-fb'
  fb.className = 'result-fb'
  fb.style.display = 'none'
  resultCard.appendChild(fb)
}
