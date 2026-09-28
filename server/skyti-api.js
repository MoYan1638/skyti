/**
 * SkyTi API — 自建轻量后端（零依赖）
 * 数据存储：/var/lib/skyti/results.json（JSON 数组，按 ts 定位）
 * 动作：
 *   POST { action: "report",   code, cn, levels, v, ts, uid, feedback }
 *   POST { action: "feedback", ts, feedback }        // 按时间戳回填意见反馈
 *   POST { action: "delete",   key, ts | tsList }    // 删除单条/多条（看板用，需 key）
 *   GET  ?action=summary                              // 公开聚合 {total, counts}（前端切真实稀有度）
 *   GET  ?action=stats                                // 拉全部数据（看板用，需 key）
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 8788
const DATA_DIR = '/var/lib/skyti'
const DATA_FILE = path.join(DATA_DIR, 'results.json')
const MAX_RECORDS = 500000
// 看板访问密钥（stats 动作需携带，防止数据被随意拉取）
const ADMIN_KEY = process.env.SKYTI_KEY || 'skyti-admin-2026'

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8')
}

function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch (e) { return [] }
}

function save(records) {
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(records), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function send(res, status, obj) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end() }

  const qs = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
  const action = qs.action

  // 公开聚合接口：前端判断是否切真实稀有度（只有计数，无个人数据）
  if (req.method === 'GET' && action === 'summary') {
    const records = load()
    const counts = {}
    for (const r of records) counts[r.code] = (counts[r.code] || 0) + 1
    return send(res, 200, { ok: true, total: records.length, counts })
  }

  if (req.method === 'GET' && action === 'stats') {
    if (qs.key !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'forbidden' })
    return send(res, 200, { ok: true, records: load() })
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })

  let body = ''
  let oversized = false
  req.on('data', c => { body += c; if (body.length > 10240) { oversized = true; req.destroy() } })
  req.on('end', () => {
    if (oversized) return
    let data = {}
    try { data = JSON.parse(body || '{}') } catch (e) { return send(res, 400, { ok: false, error: 'bad json' }) }

    if (data.action === 'report') {
      const rec = {
        code: String(data.code || '').slice(0, 20),
        cn: String(data.cn || '').slice(0, 50),
        levels: String(data.levels || '').slice(0, 20),
        v: String(data.v || '').slice(0, 20),
        ts: Number(data.ts) || Date.now(),
        // 匿名设备标识：同一浏览器多次答题归为同一人（看板分组用）
        uid: String(data.uid || '').slice(0, 24),
        feedback: String(data.feedback || '无反馈').slice(0, 200)
      }
      if (!rec.code || !rec.levels) return send(res, 400, { ok: false, error: 'missing fields' })
      const records = load()
      const i = records.findIndex(r => r.ts === rec.ts && r.v === rec.v)
      if (i >= 0) records[i] = rec; else records.push(rec)
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
      save(records)
      return send(res, 200, { ok: true, saved: 1 })
    }

    if (data.action === 'feedback') {
      const ts = Number(data.ts)
      const fb = String(data.feedback || '').slice(0, 200)
      if (!ts) return send(res, 400, { ok: false, error: 'missing ts' })
      const records = load()
      const i = records.findIndex(r => r.ts === ts)
      if (i < 0) return send(res, 404, { ok: false, error: 'record not found' })
      records[i].feedback = fb
      save(records)
      return send(res, 200, { ok: true, updated: 1 })
    }

    if (data.action === 'delete') {
      // 看板删除用：按 ts 精确删除，必须带 key
      if (data.key !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'forbidden' })
      const tsList = Array.isArray(data.tsList)
        ? data.tsList.map(Number).filter(n => n > 0)
        : (data.ts != null && Number(data.ts) > 0 ? [Number(data.ts)] : [])
      if (!tsList.length) return send(res, 400, { ok: false, error: 'missing ts' })
      const set = new Set(tsList)
      const records = load()
      const kept = records.filter(r => !set.has(Number(r.ts)))
      const removed = records.length - kept.length
      if (removed) save(kept)
      return send(res, 200, { ok: true, removed })
    }

    send(res, 400, { ok: false, error: 'unknown action' })
  })
})

ensureData()
server.listen(PORT, '127.0.0.1', () => console.log(`skyti-api listening on 127.0.0.1:${PORT}`))
