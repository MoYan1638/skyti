/**
 * SkyTi — 匿名结果上报（用于收集真实稀有度 + 携带意见反馈）
 * 每次测试出结果上报一条记录：{code, cn, levels, v, ts, uid, feedback}
 * uid 是随机生成的匿名设备标识（只存在本机 localStorage），用于把同一人的多次答题归组。
 * feedback 默认为「无反馈」；用户提交反馈后，按 ts 定位本条记录并更新。
 * 后端：自建轻量接口（skyti-api，https://api.moyan06.icu）
 *   POST / {action:"report", code, cn, levels, v, ts, uid, feedback, detail}
 *   detail：题目ID→选项序号的答题明细（仅选项编号，不含题目原文/个人信息），供后台完整还原
 *   POST / {action:"feedback", ts, feedback}
 *   GET  /?action=stats
 * 未配置（stats.enabled=false）时静默跳过，不影响测试。
 * 不收集任何个人信息、IP 关联或题目原文。
 */
import config from './data/config.json' with { type: 'json' }

const stats = config.stats || {}
const UID_KEY = 'skyti_uid_v1'
const QUEUE_KEY = 'skyti_report_queue_v1'
const RETRY_KEY = 'skyti_fb_retry_v1'
const PENDING_KEY = 'skyti_feedback_pending_v1'
const LAST_KEY = 'skyti_last_result_ts_v1'
const MAX_QUEUE = 30

let lastTs = null

function isFriendMode() {
  return !!new URLSearchParams(location.search).get('f')
}

/** 匿名设备标识：同一浏览器多次答题归为同一人（看板按此分组）。不含任何个人信息。 */
function getUid() {
  try {
    let id = localStorage.getItem(UID_KEY)
    if (!id) {
      id = 'u' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7)
      localStorage.setItem(UID_KEY, id)
    }
    return id
  } catch (e) { return '' }
}

function configured() {
  return !!(stats.enabled && stats.apiBase)
}

/** 单条上报，失败则进本地队列等待下次重试 */
function send(payload) {
  fetch(`${stats.apiBase}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ action: 'report' }, payload))
  }).catch(() => {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
      q.push(payload)
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)))
    } catch (e) { /* ignore */ }
  })
}

/** 反馈更新失败时记入重试列表 */
function retryFeedback(ts, text) {
  try {
    const r = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]')
    r.push({ ts, feedback: text })
    localStorage.setItem(RETRY_KEY, JSON.stringify(r.slice(-10)))
  } catch (e) { /* ignore */ }
}

function patchFeedback(ts, text) {
  fetch(`${stats.apiBase}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'feedback', ts, feedback: text })
  }).catch(() => retryFeedback(ts, text))
}

/** 重试队列里攒下的失败记录 + 未写成功的反馈 */
function flushQueue() {
  if (!configured()) return
  let q = []
  try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch (e) { /* ignore */ }
  if (q.length) {
    localStorage.removeItem(QUEUE_KEY)
    q.forEach(p => send(p))
  }
  let retries = []
  try { retries = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]') } catch (e) { /* ignore */ }
  if (retries.length) {
    localStorage.removeItem(RETRY_KEY)
    retries.forEach(r => patchFeedback(r.ts, r.feedback))
  }
}

/**
 * 在结果页调用：reportResult(primary, levelsStr)
 * 好友测评模式（帮别人答）不上报，保证数据是真实自测。
 * 若用户之前在首页等处提前写过反馈，合并进本条记录。
 */
export function reportResult(primary, levelsStr, answersDetail) {
  if (isFriendMode()) return
  const ts = Date.now()
  lastTs = ts
  try { localStorage.setItem(LAST_KEY, String(ts)) } catch (e) { /* ignore */ }

  // 合并提前写下的反馈（如首页入口提交、当时后端不可用）
  let fb = '无反馈'
  try {
    const pending = localStorage.getItem(PENDING_KEY)
    if (pending) { fb = pending; localStorage.removeItem(PENDING_KEY) }
  } catch (e) { /* ignore */ }

  const payload = {
    code: primary.code,
    cn: primary.cn,
    levels: levelsStr || '',
    v: config.display.version || 'standard',
    ts,
    uid: getUid(),
    feedback: fb,
    detail: answersDetail && typeof answersDetail === 'object' ? answersDetail : undefined
  }
  if (!configured()) return
  send(payload)
  flushQueue()
}

/**
 * 用户提交意见反馈时调用：把反馈写进本条结果记录。
 * 本条结果已上报 → 立即更新；否则暂存，等上报时合并。
 */
export function attachFeedback(text) {
  const ts = lastTs || parseInt(localStorage.getItem(LAST_KEY) || '0', 10)
  if (configured() && ts) {
    patchFeedback(ts, text)
    return
  }
  try { localStorage.setItem(PENDING_KEY, text) } catch (e) { /* ignore */ }
}
