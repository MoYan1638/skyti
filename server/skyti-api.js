/**
 * SkyTi API — 自建轻量后端（零依赖）
 * 数据存储：/var/lib/skyti/results.json（JSON 数组，按 ts 定位）
 * 动作：
 *   POST { action: "report",   code, cn, levels, v, ts, uid, feedback, detail }
 *   POST { action: "feedback", ts, feedback }        // 按时间戳回填意见反馈
 *   POST { action: "delete",   key, ts | tsList }    // 删除单条/多条（看板用，需 key）
 *   GET  ?action=summary                              // 公开聚合 {total, counts}（前端切真实稀有度）
 *   GET  ?action=stats                                // 拉全部数据（看板用，需 key）
 *   GET  ?action=my&uid=xxx                           // 按匿名 uid 查「本人历史」（前端旅行记录在换设备/清缓存后恢复用）
 *   POST { action: "link", from, to }                 // 把 from 名下的记录过户到 to（老域名迁移用：uid 换了但历史要留住）
 *   POST { action: "login",  code, uid }              // 抖音账号标识收集：tt.login 凭证换 openid（需 DOUYIN_APP_SECRET），与匿名 uid 绑定
 */
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

const PORT = 8788
const DATA_DIR = '/var/lib/skyti'
const DATA_FILE = path.join(DATA_DIR, 'results.json')
const MAX_RECORDS = 500000
// 看板访问密钥（stats 动作需携带，防止数据被随意拉取）
const ADMIN_KEY = process.env.SKYTI_KEY || 'skyti-admin-2026'
// 抖音小程序 AppID + 换 openid 用的应用密钥（密钥只放环境变量，不进代码库）
const DOUYIN_APPID = process.env.DOUYIN_APPID || 'tt84d7f26a1aa9a10401'
const DOUYIN_SECRET = process.env.DOUYIN_APP_SECRET || ''
// 账号绑定存储：{uid, openid, code, at} 列表（独立于 results.json，不进任何统计）
const LOGINS_FILE = path.join(DATA_DIR, 'logins.json')
const MAX_LOGINS = 50000

function loadLogins() {
  try {
    const arr = JSON.parse(fs.readFileSync(LOGINS_FILE, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch (e) { return [] }
}

function saveLogins(logins) {
  const tmp = LOGINS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(logins), 'utf8')
  fs.renameSync(tmp, LOGINS_FILE)
}

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
  // minSample 是「切换真实稀有度」的全平台样本阈值（web + 抖音端合计），三端共用这一个事实源
  if (req.method === 'GET' && action === 'summary') {
    const records = load().filter(r => !r.fbOnly)   // 独立反馈条目不进稀有度统计
    const counts = {}
    for (const r of records) counts[r.code] = (counts[r.code] || 0) + 1
    return send(res, 200, { ok: true, total: records.length, counts, minSample: 300 })
  }

  if (req.method === 'GET' && action === 'stats') {
    if (qs.key !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'forbidden' })
    // 按平台过滤（看板分支页依赖）：无 platform 参数 = 全量（主站汇总用）
    const PLATFORMS = ['web', 'douyin_mp']
    const want = String(qs.platform || '')
    let records = load()
    if (want && PLATFORMS.indexOf(want) >= 0) {
      records = records.filter(r => (r.platform ? String(r.platform) : 'web') === want)
    }
    return send(res, 200, { ok: true, records })
  }

  // 按匿名 uid 查本人历史：前端旅行记录在换设备/清缓存后恢复用。
  // uid 是浏览器本地随机串（等于取件码）；只回类型/维度等级/版本/时间，不含反馈与答题明细。
  if (req.method === 'GET' && action === 'my') {
    const uid = String(qs.uid || '').slice(0, 24)
    if (!uid) return send(res, 400, { ok: false, error: 'missing uid' })
    const records = load()
      .filter(r => r.uid === uid && !r.fbOnly)   // 旅行记录只收答题结果
      .sort((a, b) => a.ts - b.ts)
      .slice(-20)
      .map(r => ({ code: r.code, cn: r.cn, levels: r.levels, v: r.v, ts: r.ts }))
    return send(res, 200, { ok: true, records })
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
      // 答题明细（题目ID → 选项序号）：仅选项编号，无题目原文/用户信息；限 120 题防滥用
      let detail = null
      if (data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail)) {
        detail = {}
        for (const k of Object.keys(data.detail).slice(0, 120)) {
          const val = Number(data.detail[k])
          detail[String(k).slice(0, 12)] = Number.isFinite(val) ? val : -1
        }
      }
      // 平台标识：网页端 web / 抖音小程序 douyin_mp；不带或不认识的值一律归 web（老数据无此字段同）
      const plat = String(data.platform || '').slice(0, 20)
      const rec = {
        platform: ['web', 'douyin_mp'].indexOf(plat) >= 0 ? plat : 'web',
        code: String(data.code || '').slice(0, 20),
        cn: String(data.cn || '').slice(0, 50),
        levels: String(data.levels || '').slice(0, 20),
        v: String(data.v || '').slice(0, 20),
        ts: Number(data.ts) || Date.now(),
        // 匿名设备标识：同一浏览器多次答题归为同一人（看板分组用）
        uid: String(data.uid || '').slice(0, 24),
        feedback: String(data.feedback || '无反馈').slice(0, 200),
        detail
      }
      if (!rec.code || !rec.levels) return send(res, 400, { ok: false, error: 'missing fields' })
      const records = load()
      // 反馈合并去重：报告前已到的独立反馈（fbOnly/refTs）+ 旧记录已有反馈 + 报告体里捎带的反馈文本，全量并入不丢不重
      const acc = []
      const pushFb = (f) => { if (f && f.text && !acc.some(x => x.text === f.text)) acc.push(f) }
      const early = records.filter(r => r.fbOnly && r.refTs === rec.ts)
      early.forEach(r => pushFb({ fbId: r.fbId, text: r.feedback, at: r.ts, uid: r.uid }))
      const i = records.findIndex(r => r.ts === rec.ts && r.v === rec.v && !r.fbOnly)
      if (i >= 0) {
        const prev = records[i]
        if (Array.isArray(prev.feedbacks) && prev.feedbacks.length) prev.feedbacks.forEach(pushFb)
        else if (prev.feedback && prev.feedback !== '无反馈') {
          pushFb({ fbId: 'legacy-' + prev.ts, text: prev.feedback, at: Number(prev.ts) || 0, uid: prev.uid })
        }
      }
      if (rec.feedback && rec.feedback !== '无反馈') {
        pushFb({ fbId: 'rep-' + rec.ts, text: rec.feedback, at: Date.now(), uid: rec.uid })
      }
      if (acc.length) {
        rec.feedbacks = acc
        rec.feedback = acc.map(f => f.text).join(' ｜ ')
      }
      if (i >= 0) records[i] = rec; else records.push(rec)
      if (early.length) {
        const gone = new Set(early)
        for (let j = records.length - 1; j >= 0; j--) if (gone.has(records[j])) records.splice(j, 1)
      }
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
      save(records)
      return send(res, 200, { ok: true, saved: 1 })
    }

    if (data.action === 'link') {
      // 老域名迁移：把 from 名下的记录过户到 to（uid 换了但历史要留住）。
      // 无鉴权，靠 uid 随机性保密，与 action=my 同级；只改 uid，不动其他字段。
      const from = String(data.from || '').slice(0, 24)
      const to = String(data.to || '').slice(0, 24)
      if (!from || !to || from === to) return send(res, 400, { ok: false, error: 'bad uid' })
      const records = load()
      let moved = 0
      for (const r of records) if (r.uid === from) { r.uid = to; moved++ }
      if (moved) save(records)
      return send(res, 200, { ok: true, moved })
    }

    if (data.action === 'feedback') {
      // 反馈即时独立入库：每条反馈一次调用、各自成条；fbId 幂等去重（客户端重试安全）
      // refTs/ts 命中已有结果记录 → 追加到该记录的 feedbacks（多条完整保留，feedback 为拼接文本兼容旧看板）
      // 无 refTs 或记录未落库（如上报在途）→ 独立反馈条目（fbOnly），不依赖后续答题
      const refTs = Number(data.refTs || data.ts) || 0
      const fb = String(data.feedback || data.text || '').slice(0, 200)
      const uid = String(data.uid || '').slice(0, 24)
      const fbId = String(data.fbId || '').slice(0, 48)
      if (!fb) return send(res, 400, { ok: false, error: 'missing feedback' })
      const records = load()
      if (fbId) {
        const dup = records.some(r =>
          r.fbId === fbId ||
          (Array.isArray(r.feedbacks) && r.feedbacks.some(f => f && f.fbId === fbId)))
        if (dup) return send(res, 200, { ok: true, deduped: true })
      }
      const entry = { fbId, text: fb, at: Date.now(), uid }
      const i = refTs ? records.findIndex(r => r.ts === refTs && !r.fbOnly) : -1
      if (i >= 0) {
        const rec = records[i]
        if (!Array.isArray(rec.feedbacks)) {
          // 老记录：原 feedback 文本升格为一条历史反馈，不再覆盖
          rec.feedbacks = (rec.feedback && rec.feedback !== '无反馈')
            ? [{ fbId: 'legacy-' + rec.ts, text: rec.feedback, at: Number(rec.ts) || 0, uid: rec.uid }] : []
        }
        rec.feedbacks.push(entry)
        rec.feedback = rec.feedbacks.map(f => f.text).join(' ｜ ')
        save(records)
        return send(res, 200, { ok: true, updated: 1 })
      }
      // 独立反馈条目：fbOnly 不进统计/旅行记录，但保留在数据里可查（platform 与结果同口径归类）
      const fplat = String(data.platform || '').slice(0, 20)
      records.push({
        platform: ['web', 'douyin_mp'].indexOf(fplat) >= 0 ? fplat : 'web',
        code: 'FEEDBACK', cn: '意见反馈', levels: '', v: '',
        ts: Date.now(), uid, feedback: fb, fbId, refTs, fbOnly: true, detail: null
      })
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
      save(records)
      return send(res, 200, { ok: true, saved: 1 })
    }

    if (data.action === 'login') {
      // 抖音账号标识收集：客户端 tt.login（静默）取 code，这里换 openid 与匿名 uid 绑定。
      // 用途：反馈关联、体验优化对接（隐私指引已声明「抖音账号信息」）。
      // DOUYIN_APP_SECRET 未配置时退化为记录登录事件（uid+code），配上后自动升级为 openid。
      const code = String(data.code || '').slice(0, 128)
      const uid = String(data.uid || '').slice(0, 24)
      if (!code) return send(res, 400, { ok: false, error: 'missing code' })
      const finish = (openid) => {
        openid = String(openid || '')
        const logins = loadLogins()
        const exists = logins.some(l => l.uid === uid && (
          (openid && l.openid === openid) || (!openid && l.code === code)
        ))
        if (!exists) {
          logins.push({ uid, openid: openid || '', code: openid ? '' : code, at: Date.now() })
          if (logins.length > MAX_LOGINS) logins.splice(0, logins.length - MAX_LOGINS)
          saveLogins(logins)
        }
        return send(res, 200, { ok: true, bound: !!openid })
      }
      if (!DOUYIN_SECRET) return finish('')
      const u = 'https://developer.open-douyin.com/api/v1/oauth/access_token?appid=' +
        encodeURIComponent(DOUYIN_APPID) + '&secret=' + encodeURIComponent(DOUYIN_SECRET) +
        '&code=' + encodeURIComponent(code)
      https.get(u, (r) => {
        let body = ''
        r.on('data', c => body += c)
        r.on('end', () => {
          let openid = ''
          try {
            const j = JSON.parse(body)
            openid = (j.data && (j.data.openid || j.data.open_id)) || ''
          } catch (e) {}
          finish(openid)
        })
      }).on('error', () => finish(''))
      return
    }

    if (data.action === 'delete') {
      // 看板删除用：按 ts 精确删除，必须带 key
      if (data.key !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'forbidden' })
      const tsList = Array.isArray(data.tsList)
        ? data.tsList.map(Number).filter(n => n > 0)
        : (data.ts != null && Number(data.ts) > 0 ? [Number(data.ts)] : [])
      if (!tsList.length) return send(res, 400, { ok: false, error: 'missing ts' })
      const set = new Set(tsList)
      // 平台护栏：带 platform 时只删该平台的记录——就算 ts 混进别的平台也不误伤
      const PLATFORMS = ['web', 'douyin_mp']
      const scope = String(data.platform || '')
      const scoped = scope && PLATFORMS.indexOf(scope) >= 0
      const platOf = r => (r.platform ? String(r.platform) : 'web')
      const inScope = r => !scoped || platOf(r) === scope
      const records = load()
      const removedRecs = records.filter(r => set.has(Number(r.ts)) && inScope(r))
      if (removedRecs.length) {
        // 删前留恢复点：整份快照（留最近 10 份）+ 被删记录进 trash.jsonl，误删可回捞
        try {
          const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')
          fs.writeFileSync(path.join(DATA_DIR, 'results.json.bak-' + stamp), JSON.stringify(records), 'utf8')
          fs.appendFileSync(path.join(DATA_DIR, 'trash.jsonl'),
            removedRecs.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8')
          const baks = fs.readdirSync(DATA_DIR).filter(f => f.indexOf('results.json.bak-') === 0).sort()
          while (baks.length > 10) { try { fs.unlinkSync(path.join(DATA_DIR, baks.shift())) } catch (e) {} }
        } catch (e) {}
        const removedSet = new Set(removedRecs)
        save(records.filter(r => !removedSet.has(r)))
      }
      return send(res, 200, { ok: true, removed: removedRecs.length })
    }

    send(res, 400, { ok: false, error: 'unknown action' })
  })
})

ensureData()
server.listen(PORT, '127.0.0.1', () => console.log(`skyti-api listening on 127.0.0.1:${PORT}`))
