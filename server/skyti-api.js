/**
 * SkyTi API — 自建轻量后端（零依赖）
 * 数据存储：/var/lib/skyti/results.json（JSON 数组，按 ts 定位）
 * 动作：
 *   POST { action: "report",   code, cn, levels, v, ts, uid, feedback, detail }
 *   POST { action: "feedback", ts, feedback }        // 按时间戳回填意见反馈
 *   POST { action: "delete",   key, ts | tsList }    // 删除单条/多条（看板用，需 key）
 *   GET  ?action=summary[&ch]                         // 公开聚合 {total, counts, minSample}（缺省全渠道汇总，ch 可切片）
 *   GET  ?action=stats                                // 拉全部数据（看板用，需 key）
 *   GET  ?action=my&uid=xxx                           // 按匿名 uid 查「本人历史」（前端旅行记录在换设备/清缓存后恢复用）
 *   POST { action: "link", from, to }                 // 把 from 名下的记录过户到 to（老域名迁移用：uid 换了但历史要留住）
 *   POST { action: "login",  code, uid }              // 抖音账号标识收集：tt.login 凭证换 openid（需 DOUYIN_APP_SECRET），与匿名 uid 绑定
 *   GET  ?action=channels[&key]                       // 渠道注册表列表（公开只回启用渠道；带 admin key 回全部）
 *   GET  ?action=channel_config&ch=xxx                // 渠道生效配置（全局+渠道合并，客户端本地兜底）
 *   POST { action: "channel", key, channelKey, ... }  // 渠道注册/配置 upsert（需 admin key）
 * 渠道（=记录上的 platform 字段）注册表：/var/lib/skyti/channels.json —— 渠道白名单与渠道配置的唯一事实源。
 * 统计口径铁律：对外真实数据 = 全渠道汇总（web+抖音合计，不含 fbOnly）；对内查询/删除/配置按渠道切片。
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
// 渠道注册表：渠道 key 白名单 + 全局/渠道配置的唯一事实源（记录上的 platform 字段即渠道 key）
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json')
const DEFAULT_CHANNELS = {
  schema: 2,
  settings: { minSample: 300 },   // 全渠道样本阈值：真实稀有度切换判定（全渠道汇总口径，不分渠道）
  channels: {
    web:       { name: '网页端',     enabled: true, reportEnabled: true, order: 1, ext: {} },
    douyin_mp: { name: '抖音小程序', enabled: true, reportEnabled: true, order: 2, ext: {} }
  }
}

function loadChannels() {
  try {
    const j = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'))
    if (j && typeof j === 'object' && j.channels && typeof j.channels === 'object' && !Array.isArray(j.channels)) {
      return { schema: 2, settings: Object.assign({}, DEFAULT_CHANNELS.settings, j.settings || {}), channels: j.channels }
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_CHANNELS))
}

function saveChannels(reg) {
  const tmp = CHANNELS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(reg), 'utf8')
  fs.renameSync(tmp, CHANNELS_FILE)
}

// platform 缺省归 web（已上线 web 客户端不带该字段）；未注册渠道拒绝、停用渠道拒收——防脏数据混入统计
function resolveChannel(platform, reg) {
  const key = String(platform || '').slice(0, 20) || 'web'
  const ch = reg.channels[key]
  if (!ch) return { error: 'unknown_channel' }
  if (ch.enabled === false || ch.reportEnabled === false) return { error: 'channel_disabled' }
  return { key, ch }
}

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
  if (!fs.existsSync(CHANNELS_FILE)) fs.writeFileSync(CHANNELS_FILE, JSON.stringify(DEFAULT_CHANNELS), 'utf8')
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
  // 统计口径铁律：对外真实数据 = 全渠道汇总（web + 抖音合计，不含 fbOnly）；minSample 是「切换真实稀有度」的
  // 全渠道样本阈值，三端共用这一个事实源。ch 参数仅供看板切片，不改变对外口径。
  if (req.method === 'GET' && action === 'summary') {
    const reg = loadChannels()
    const want = String(qs.ch || '').slice(0, 20)
    let records = load().filter(r => !r.fbOnly)   // 独立反馈条目不进稀有度统计
    if (want) {
      if (!reg.channels[want]) return send(res, 400, { ok: false, error: 'unknown_channel' })
      records = records.filter(r => (r.platform ? String(r.platform) : 'web') === want)
    }
    const counts = {}
    for (const r of records) counts[r.code] = (counts[r.code] || 0) + 1
    return send(res, 200, { ok: true, total: records.length, counts, minSample: Number(reg.settings.minSample) || 300 })
  }

  if (req.method === 'GET' && action === 'stats') {
    if (qs.key !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'forbidden' })
    // 按渠道过滤（看板分支页依赖，ch 与 platform 同义）：无参数 = 全量（主站汇总用）；白名单读渠道注册表
    const reg = loadChannels()
    const want = String(qs.ch || qs.platform || '').slice(0, 20)
    let records = load()
    if (want && reg.channels[want]) {
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

  // 渠道注册表列表（公开只回启用渠道；带 admin key 回全部，看板渠道管理面板用）
  if (req.method === 'GET' && action === 'channels') {
    const reg = loadChannels()
    const isAdmin = qs.key === ADMIN_KEY
    const channels = Object.keys(reg.channels)
      .filter(k => isAdmin || reg.channels[k].enabled !== false)
      .map(k => {
        const c = reg.channels[k]
        return {
          key: k,
          name: String(c.name || k).slice(0, 30),
          enabled: c.enabled !== false,
          reportEnabled: c.reportEnabled !== false,
          order: Number(c.order) || 0
        }
      })
      .sort((a, b) => a.order - b.order)
    return send(res, 200, { ok: true, channels, minSample: Number(reg.settings.minSample) || 300 })
  }

  // 渠道生效配置（全局+渠道合并）：客户端启动拉取，失败回落本地 config（沿用 minSample 兜底模式）
  if (req.method === 'GET' && action === 'channel_config') {
    const reg = loadChannels()
    const key = String(qs.ch || '').slice(0, 20)
    const ch = reg.channels[key]
    if (!ch) return send(res, 404, { ok: false, error: 'unknown_channel' })
    return send(res, 200, {
      ok: true,
      minSample: Number(reg.settings.minSample) || 300,
      channel: {
        key,
        name: String(ch.name || key).slice(0, 30),
        enabled: ch.enabled !== false,
        reportEnabled: ch.reportEnabled !== false,
        ext: (ch.ext && typeof ch.ext === 'object' && !Array.isArray(ch.ext)) ? ch.ext : {}
      }
    })
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
      // 渠道标识（platform）：缺省归 web（已上线 web 客户端不带该字段）；未注册/停用渠道拒绝，白名单读渠道注册表
      const reg = loadChannels()
      const cv = resolveChannel(data.platform, reg)
      if (cv.error) return send(res, cv.error === 'unknown_channel' ? 400 : 403, { ok: false, error: cv.error })
      const rec = {
        platform: cv.key,
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
      // 渠道校验与结果上报同口径（缺省 web、未注册拒绝、停用拒收），追加与独立条目两条路径都拦住
      const freg = loadChannels()
      const fcv = resolveChannel(data.platform, freg)
      if (fcv.error) return send(res, fcv.error === 'unknown_channel' ? 400 : 403, { ok: false, error: fcv.error })
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
      records.push({
        platform: fcv.key,
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
      // 平台护栏：带 platform 时只删该渠道的记录——就算 ts 混进别的渠道也不误伤（白名单读渠道注册表）
      const reg = loadChannels()
      const scope = String(data.platform || '').slice(0, 20)
      const scoped = scope && !!reg.channels[scope]
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

    // 渠道注册/配置 upsert（看板渠道管理面板用）：只增改不删——退役走 enabled:false，历史数据保持可解释
    if (data.action === 'channel') {
      if (data.key !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'forbidden' })
      const key = String(data.channelKey || '').slice(0, 20)
      if (!/^[a-z0-9_]{2,20}$/.test(key)) return send(res, 400, { ok: false, error: 'bad channel key' })
      const reg = loadChannels()
      const prev = reg.channels[key] || {}
      const ch = {
        name: String(data.name != null ? data.name : (prev.name || key)).slice(0, 30) || key,
        enabled: data.enabled != null ? !!data.enabled : prev.enabled !== false,
        reportEnabled: data.reportEnabled != null ? !!data.reportEnabled : prev.reportEnabled !== false,
        order: Number(data.order != null ? data.order : prev.order) || 0,
        ext: (data.ext && typeof data.ext === 'object' && !Array.isArray(data.ext)) ? data.ext : (prev.ext || {})
      }
      reg.channels[key] = ch
      saveChannels(reg)
      return send(res, 200, { ok: true, channel: Object.assign({ key }, ch) })
    }

    send(res, 400, { ok: false, error: 'unknown action' })
  })
})

ensureData()
server.listen(PORT, '127.0.0.1', () => console.log(`skyti-api listening on 127.0.0.1:${PORT}`))
