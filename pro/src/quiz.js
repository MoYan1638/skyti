/**
 * SkyTi — 答题流程 + 结果渲染
 */
import { calcDimensionScores, scoresToLevels, matchAllTypes } from './engine.js'
import { drawRadarChart } from './chart.js'
import { sampleQuestions, recordUsedQuestions } from './sampler.js'
import { reportResult, getUid } from './report.js'
import { resetFeedbackDisplay } from './feedback.js'
import { createMorph } from 'morphicons/dom'
import pool from './data/questions-pool.json' with { type: 'json' }
import types from './data/types.json' with { type: 'json' }
import config from './data/config.json' with { type: 'json' }

/* ─── morphicons：图标形变（箭头 ↔ 星光 / 圆点 ↔ 对勾）─── */
const ICON_ARROW = 'M5 12h14m-7-7 7 7-7 7'
const ICON_STAR = 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4'
const ICON_CIRCLE = 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z'
const ICON_CHECK = 'M20 6 9 17l-5-5'

let nextMorph = null
function initNextMorph() {
  const el = document.getElementById('btn-next-icon')
  if (el && !nextMorph) nextMorph = createMorph(el, ICON_ARROW)
  return nextMorph
}

const { standard, special } = types
const { display } = config

const dimOrder = ['S1','S2','S3','E1','E2','E3','A1','A2','A3','Ac1','Ac2','Ac3','So1','So2','So3']
/* 15 位等级串（如 "HMLLMHHMLMHLMML"）→ { 维度: L/M/H } */
function levelsFromStr(str) {
  const levels = {}
  dimOrder.forEach((d, i) => { levels[d] = str[i] || 'M' })
  return levels
}

// 每次加载：从 100 题总库按维度均衡抽样
const allQuestions = sampleQuestions(pool.main, display.totalQuestions, dimOrder)

/* ─── 真实稀有度：样本攒够后自动替换模拟值 ─── */
let realStats = null      // { total, counts } 上报后端聚合
let currentRarityStr = '' // 当前结果用的稀有度文案（长图卡复用）
;(async () => {
  try {
    const api = config.stats && config.stats.apiBase
    if (!api) return
    const r = await fetch(`${api}/?action=summary`)
    const d = await r.json()
    if (d.ok && d.total >= (config.stats.minSample || 500)) {
      realStats = d
      // 若结果页已打开，重刷一次让真实稀有度生效
      if (document.getElementById('page-result')?.classList.contains('active')) renderResult()
    }
  } catch (e) { /* 静默，沿用模拟值 */ }
})()
function rarityOf(code, fallback) {
  if (realStats && realStats.counts && realStats.counts[code] != null) {
    const pct = realStats.counts[code] / realStats.total * 100
    return `${pct.toFixed(1)}% · 真实数据（${realStats.total} 人实测）`
  }
  return fallback || ''
}

let currentIndex = 0
let answers = {}
let answersIdx = {}        // 题目ID → 所选选项在「原始题库」里的下标（上报明细用；展示时选项顺序会被打乱，当次下标不可复用）
let replaying = false      // 重看历史结果时为 true：不再存历史/上报/污染抽题避让
let replaySnapshot = null  // 重看历史用的快照（类型 + 维度等级），非空时结果页直接按其还原
let currentResult = null   // 最近一次结果的快照，历史记录与长图都复用它

/* ─── 好友测评模式（?f= 编码的好友自测结果）─── */
function b64e(s) {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}
function b64d(s) {
  try {
    const bin = atob(s)
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  } catch (e) { return null }
}
const friendRaw = new URLSearchParams(location.search).get('f')
const friendInfo = friendRaw ? (() => {
  const [code, cn, lv] = b64d(friendRaw)?.split('|') || []
  return code && cn && lv ? { code, cn, lv } : null
})() : null
/* 好友横幅：首次出现 / 文案更新（换成对比结果）都重播一次入场动画 */
function showFriendBanner(text) {
  const fb = document.getElementById('friend-banner')
  if (!fb) return
  fb.textContent = text
  fb.style.display = 'block'
  fb.classList.remove('anim')
  void fb.offsetWidth // 强制回流，动画才能重放
  fb.classList.add('anim')
}
if (friendInfo) {
  showFriendBanner(`💌 好友测评模式：你在帮「${friendInfo.cn}」答题——凭你对 TA 的印象来选哦`)
}
/* 版本切换器带上 ?f= 一起跳：好友测评模式换版本不能丢，
   否则会被当成自测（还会把结果当成自己的上报） */
if (friendRaw) {
  document.querySelectorAll('.version-switcher a').forEach(a => {
    try {
      const u = new URL(a.getAttribute('href'), location.href)
      u.searchParams.set('f', friendRaw)
      a.setAttribute('href', u.toString())
    } catch (e) { /* ignore */ }
  })
}

/* ─── 页面切换 ─── */
export function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-' + id)?.classList.add('active')
  if (id === 'result') renderResult()
  if (id === 'intro') renderHistory()
}

/* ─── 开始 ─── */
document.getElementById('btn-start')?.addEventListener('click', () => {
  currentIndex = 0
  answers = {}
  answersIdx = {}
  replaySnapshot = null
  // 选项乱序防背题：每次开测随机打乱，同一轮内前后翻页顺序保持一致
  // _oi 记住该选项在原始题库里的下标（打乱后仍能还原成看板可识别的选项编号）
  allQuestions.forEach(q => {
    const a = q.options.map((o, oi) => ({ ...o, _oi: oi }))
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    q.options = a
  })
  showPage('quiz')
})
document.getElementById('btn-prev')?.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--
    renderQuestion()
  }
})
document.getElementById('btn-next')?.addEventListener('click', () => {
  const q = allQuestions[currentIndex]
  if (answers[q.id] == null) {
    showToast('请先选择一个选项')
    return
  }
  if (currentIndex < allQuestions.length - 1) {
    currentIndex++
    renderQuestion()
  } else {
    showPage('result')
  }
})
renderQuestion()

function renderQuestion() {
  const q = allQuestions[currentIndex]
  document.getElementById('question-text').textContent = q.text
  document.getElementById('progress-fill').style.width =
    ((currentIndex + 1) / allQuestions.length * 100) + '%'
  document.getElementById('progress-text').textContent =
    `${currentIndex + 1} / ${allQuestions.length}`

  const optsEl = document.getElementById('options')
  optsEl.innerHTML = ''
  q.options.forEach((opt, oi) => {
    const btn = document.createElement('button')
    btn.className = 'option-btn'
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    marker.setAttribute('viewBox', '0 0 24 24')
    marker.setAttribute('width', '20')
    marker.setAttribute('height', '20')
    marker.setAttribute('fill', 'none')
    marker.setAttribute('stroke', 'currentColor')
    marker.setAttribute('stroke-width', '2')
    marker.setAttribute('stroke-linecap', 'round')
    marker.setAttribute('stroke-linejoin', 'round')
    marker.classList.add('opt-marker')
    const mPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    marker.appendChild(mPath)
    const label = document.createElement('span')
    label.className = 'opt-label'
    label.textContent = opt.label
    btn.appendChild(marker)
    btn.appendChild(label)
    const selected = answers[q.id] === opt.value
    if (selected) {
      btn.classList.add('selected')
      mPath.setAttribute('d', ICON_CHECK)
    } else {
      mPath.setAttribute('d', ICON_CIRCLE)
      // 点击时：圆点 → 对勾 弹簧形变，稍作停留再进入下一题
      btn.addEventListener('click', () => {
        btn.classList.add('selected')
        try { createMorph(mPath, ICON_CIRCLE).morphTo(ICON_CHECK) } catch (e) { mPath.setAttribute('d', ICON_CHECK) }
      })
    }
    btn.addEventListener('click', () => selectOption(q.id, opt.value, opt._oi != null ? opt._oi : oi))
    optsEl.appendChild(btn)
  })

  // 重触发入场动画
  const area = document.querySelector('.question-area')
  if (area) {
    area.classList.remove('q-enter')
    void area.offsetWidth
    area.classList.add('q-enter')
  }
  optsEl.classList.remove('q-enter')
  void optsEl.offsetWidth
  optsEl.classList.add('q-enter')

  // 导航按钮状态
  const prevBtn = document.getElementById('btn-prev')
  const nextBtn = document.getElementById('btn-next')
  prevBtn.style.visibility = currentIndex > 0 ? 'visible' : 'hidden'
  nextBtn.style.visibility = 'visible'
  const isLast = currentIndex >= allQuestions.length - 1
  document.getElementById('btn-next-label').textContent = isLast ? '查看结果' : '下一题'
  const m = initNextMorph()
  if (m) {
    try { m.morphTo(isLast ? ICON_STAR : ICON_ARROW) } catch (e) { /* 忽略形变失败 */ }
  }
}

function selectOption(qId, value, oi) {
  answers[qId] = value
  if (oi != null) answersIdx[qId] = oi
  // 留 260ms 给「圆点→对勾」形变动画，再切下一题
  setTimeout(() => {
    if (currentIndex < allQuestions.length - 1) {
      currentIndex++
      renderQuestion()
    } else {
      showPage('result')
    }
  }, 260)
}

/* ─── 结果渲染 ─── */
function renderResult() {
  resetFeedbackDisplay() // 清掉上一次的反馈展示
  let levels, matched, primary
  if (replaySnapshot && typeof replaySnapshot.levels === 'string') {
    // 重看历史：用当时存下的维度等级还原。
    // 不能拿当时的答案配「本次页面加载时随机抽到的题」重算——两次抽题不是同一批，算出来必然是错的
    levels = levelsFromStr(replaySnapshot.levels)
    matched = matchAllTypes(levels, dimOrder, standard, special)
    primary = matched.find(t => t.code === replaySnapshot.code) ||
      { code: replaySnapshot.code, cn: replaySnapshot.cn, rarity: replaySnapshot.rarity, intro: '', desc: '', badge: '' }
  } else {
    const scores = calcDimensionScores(answers, allQuestions)
    const qCounts = {}
    for (const q of allQuestions) qCounts[q.dim] = (qCounts[q.dim] || 0) + 1
    levels = scoresToLevels(scores, config.scoring.levelFractions, qCounts)
    matched = matchAllTypes(levels, dimOrder, standard, special)
    primary = matched[0]
  }
  // 本次结果的完整快照：历史记录与结果长图都复用它，避免二次重算
  const levelsStr = dimOrder.map(d => levels[d]).join('')
  currentResult = { levels, levelsStr, primary, matched }

  document.getElementById('result-code').textContent = primary.code
  document.getElementById('result-name').textContent = primary.cn
  document.getElementById('result-intro').textContent = primary.intro
  document.getElementById('result-desc').textContent = primary.desc
  document.getElementById('result-badge').textContent = primary.badge || ''

  // 稀有度（样本足够时自动切真实占比）
  currentRarityStr = rarityOf(primary.code, primary.rarity)
  const rarEl = document.getElementById('result-rarity')
  if (rarEl) rarEl.textContent = currentRarityStr ? `✦ 全网约 ${currentRarityStr} 的旅人与你同频 ✦` : ''

  // 牵手搭子 / 斗篷不合
  if (primary.cp) {
    document.getElementById('cp-name').textContent = `${primary.cp.cn}（${primary.cp.code}）`
    document.getElementById('cp-line').textContent = primary.cp.line
    document.getElementById('rival-name').textContent = `${primary.rival.cn}（${primary.rival.code}）`
    document.getElementById('rival-line').textContent = primary.rival.line
  }

  // 次要匹配
  const secondaryEl = document.getElementById('result-secondary')
  if (matched[1]) {
    secondaryEl.style.display = 'block'
    document.getElementById('secondary-info').textContent =
      `${matched[1].cn}（${matched[1].code}）— 相似度 ${matched[1].similarity}%`
  } else {
    secondaryEl.style.display = 'none'
  }

  // 雷达图
  const canvas = document.getElementById('radar-chart')
  const userVec = dimOrder.map(d => ({ L: 1, M: 2, H: 3 }[levels[d]]))
  drawRadarChart(canvas, dimOrder, userVec)

  // 维度详情
  const dimNames = {
    S1:'光之自信', S2:'内心清晰', S3:'光之追求',
    E1:'羁绊安全', E2:'情感投入', E3:'边界独处',
    A1:'社交主动', A2:'包容耐心', A3:'攀比竞争',
    Ac1:'探索冒险', Ac2:'目标规划', Ac3:'效率过程',
    So1:'主动社交', So2:'社交广度', So3:'给予分享'
  }
  const levelNames = { L: '低', M: '中', H: '高' }
  const detailEl = document.getElementById('dimensions-detail')
  detailEl.innerHTML = ''
  dimOrder.forEach(dim => {
    const lv = levels[dim]
    const item = document.createElement('div')
    item.className = 'dim-item'
    item.innerHTML = `<span class="dim-name">${dimNames[dim]||dim}</span> <span class="dim-level dim-level-${lv}">${levelNames[lv]}</span>`
    detailEl.appendChild(item)
  })

  // TOP5
  const topEl = document.getElementById('top-list')
  topEl.innerHTML = ''
  matched.slice(0, 5).forEach((t, i) => {
    const div = document.createElement('div')
    div.className = 'top-item'
    div.innerHTML = `
      <span class="top-rank">#${i + 1}</span>
      <span class="top-name">${t.cn}</span>
      <span class="top-similarity">${t.similarity}%</span>
      <span class="top-badge">${t.code}</span>
    `
    topEl.appendChild(div)
  })

  // 免责声明
  document.getElementById('disclaimer').textContent = display.disclaimer

  // 记录已用题目，下次抽题避让（重看历史结果时跳过）
  if (!replaying) recordUsedQuestions(allQuestions)

  // 历史记录 / 好友对比（levelsStr 已在函数开头算好）
  if (friendInfo) {
    showFriendBanner(primary.code === friendInfo.code
      ? `🪞 神奇！你眼中的 TA 和 TA 自测都是「${friendInfo.cn}」，你们是镜像光翼！`
      : `💌 对比结果：TA 自测是「${friendInfo.cn}（${friendInfo.code}）」，你眼中的 TA 是「${primary.cn}（${primary.code}）」`)
  } else if (!replaying) {
    // 历史记录与上报共用同一个时间戳：云端补历史靠 ts 去重，两处不能各生成一个
    const ts = Date.now()
    saveHistory(ts)
    // 匿名上报：明细传「原始题库里的选项下标」（答案里存的是分值，看板无法直接映射成选项文案）
    reportResult(primary, levelsStr, Object.keys(answersIdx).length ? answersIdx : answers, ts)
  }

  // 按钮事件（onclick 赋值避免重复绑定）
  document.getElementById('btn-restart').onclick = restart
  document.getElementById('btn-share').onclick = saveResultImage
  replaying = false
  const btnFriend = document.getElementById('btn-friend')
  if (btnFriend) {
    // 好友模式下不显示邀请按钮
    btnFriend.style.display = friendInfo ? 'none' : ''
    btnFriend.onclick = () => {
      const link = `${location.origin}${location.pathname}?f=${b64e(`${primary.code}|${primary.cn}|${levelsStr}`)}`
      navigator.clipboard?.writeText(`来帮我做个光遇人格测评，看看你眼中的我是什么样：${link}`)
        .then(() => showToast('邀请链接已复制，发给好友吧！'))
        .catch(() => showToast('复制失败，请手动复制：' + link))
    }
  }
}

function restart() {
  currentIndex = 0
  answers = {}
  answersIdx = {}
  replaySnapshot = null
  showPage('intro')
}

/* ─── 历史记录 ─── */
const HISTORY_KEY = 'skyti_history_v1'
let cloudSynced = false // 云端历史只拉一次，避免 renderHistory 递归
function saveHistory(ts) {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    // 存完整结果快照（类型 + 15 维等级），重看时直接还原。
    // 只存答案不行：下次打开页面会重新随机抽题，旧答案配新题算出来的是错结果
    arr.unshift({
      code: currentResult.primary.code,
      cn: currentResult.primary.cn,
      rarity: currentResult.primary.rarity,
      levels: currentResult.levelsStr,
      date: new Date().toLocaleDateString('zh-CN'),
      ts: ts || Date.now()
    })
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, 20)))
  } catch (e) { /* ignore */ }
}
function renderHistory() {
  const sec = document.getElementById('history-section')
  if (!sec) return
  syncHistoryFromCloud() // 先把服务器上本机的历史拉回来（换设备/清缓存/旧数据都能恢复）
  let arr = []
  try { arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch (e) { /* ignore */ }
  if (!arr.length) { sec.style.display = 'none'; return }
  sec.style.display = 'block'
  const list = document.getElementById('history-list')
  list.innerHTML = ''
  arr.slice(0, 5).forEach(h => {
    const div = document.createElement('div')
    div.className = 'history-item'
    // 只有存了维度等级的新快照才能重看（旧记录只有类型，重看会算出错误结果）
    const canReplay = typeof h.levels === 'string' && h.levels.length === dimOrder.length
    div.textContent = `${h.date} · ${h.cn}（${h.code}）${canReplay ? ' · 点击重看' : ''}`
    if (canReplay) {
      div.classList.add('history-view')
      div.title = '重看这份结果，可重新保存长图'
      div.onclick = () => {
        replaying = true
        replaySnapshot = { code: h.code, cn: h.cn, levels: h.levels, rarity: h.rarity }
        showPage('result')
      }
    }
    list.appendChild(div)
  })
  document.getElementById('btn-history-clear').onclick = () => {
    localStorage.removeItem(HISTORY_KEY)
    renderHistory()
  }
}

/* ─── 云端历史补全 ───
   每次出结果都上报了（类型 + 15 维等级 + 匿名 uid），记录不会丢。
   按 uid 把服务器上的历史拉回来合并进本地旅行记录：
   换设备/清缓存、以及本次修复前留下的“只有类型没维度”的旧记录，都能恢复成可重看的快照。 */
function syncHistoryFromCloud() {
  if (cloudSynced) return
  cloudSynced = true
  const api = config.stats && config.stats.apiBase
  const uid = getUid()
  if (!api || !config.stats.enabled || !uid) return
  fetch(`${api}/?action=my&uid=${encodeURIComponent(uid)}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !d.ok || !Array.isArray(d.records) || !d.records.length) return
      let arr = []
      try { arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch (e) { /* ignore */ }
      const seen = new Set(arr.map(h => h.ts))
      const allTypes = [...standard, ...(special || [])]
      let added = 0
      d.records.forEach(r => {
        if (!r.ts || seen.has(r.ts)) return
        if (typeof r.levels !== 'string' || r.levels.length !== dimOrder.length) return
        const date = new Date(r.ts).toLocaleDateString('zh-CN')
        // 本地同期那条旧记录只有类型没维度（修 bug 前存的），用云端这份替掉，避免重复展示
        arr = arr.filter(h => !(h.code === r.code && h.date === date && typeof h.levels !== 'string'))
        const t = allTypes.find(x => x.code === r.code)
        arr.push({ code: r.code, cn: r.cn, rarity: t ? t.rarity : '', levels: r.levels, date, ts: r.ts })
        seen.add(r.ts)
        added++
      })
      if (!added) return
      arr.sort((a, b) => b.ts - a.ts)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, 20))) } catch (e) { /* ignore */ }
      renderHistory()
    })
    .catch(() => { /* 后端不可用时静默，本地记录照常用 */ })
}
renderHistory()

/* ─── 键盘快答 1-4 ─── */
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-quiz')?.classList.contains('active')) return
  const idx = ['1', '2', '3', '4'].indexOf(e.key)
  if (idx >= 0) {
    const btn = document.querySelectorAll('#options .option-btn')[idx]
    if (btn) btn.click()
  }
})

/* ─── 结果长图卡：Canvas 绘制 + 一键保存 ─── */
function saveResultImage() {
  if (!currentResult) return
  // 直接用当前结果页的快照（首次结果 / 历史重看都对），不再重算
  const { levels, matched, primary } = currentResult

  const W = 750, H = 1330
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // 夜空背景
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#060c1a')
  bg.addColorStop(0.55, '#0d1f42')
  bg.addColorStop(1, '#060c1a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 星光点缀
  ctx.fillStyle = '#8BA4CC'
  for (let i = 0; i < 90; i++) {
    const sx = Math.random() * W
    const sy = Math.random() * H
    ctx.globalAlpha = 0.08 + Math.random() * 0.35
    const r = Math.random() * 1.6 + 0.4
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // 顶部光晕
  const glow = ctx.createRadialGradient(W / 2, 120, 0, W / 2, 120, 320)
  glow.addColorStop(0, '#FFD96622')
  glow.addColorStop(1, '#FFD96600')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, 440)

  const center = (text, y, font, color) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(text, W / 2, y)
  }

  // 标题
  center('SkyTi · 光遇人格测试', 92, 'bold 34px "PingFang SC", sans-serif', '#FFD966')
  center(`— ${display.totalQuestions} 道题 · ${Object.keys(standard).length + 2} 种人格 —`, 134, '22px "PingFang SC", sans-serif', '#8BA4CC')

  // 人格结果
  center(primary.code, 250, 'bold 88px "PingFang SC", sans-serif', '#FFD966')
  center(primary.cn, 322, 'bold 52px "PingFang SC", sans-serif', '#FFFFFF')

  // intro 自动换行
  ctx.font = '26px "PingFang SC", sans-serif'
  ctx.fillStyle = '#8BA4CC'
  let yy = wrapText(ctx, primary.intro, W / 2, 388, W - 140, 40, 'center')

  // 雷达图
  const radar = document.createElement('canvas')
  radar.width = 560
  radar.height = 560
  const userVec = dimOrder.map(d => ({ L: 1, M: 2, H: 3 }[levels[d]]))
  drawRadarChart(radar, dimOrder, userVec, 2)
  ctx.drawImage(radar, (W - 560) / 2, 470)

  // 雷达图下方信息区：次要人格 + CP 搭子 / 斗篷不合
  let infoY = 1058
  if (currentRarityStr) {
    center(`✦ 全网约 ${currentRarityStr} 的旅人与你同频 ✦`, infoY, '24px "PingFang SC", sans-serif', '#FFD966')
    infoY += 34
  }
  if (matched[1]) {
    center(`相似人格：${matched[1].cn}（${matched[1].code}）· ${matched[1].similarity}%`, infoY, '22px "PingFang SC", sans-serif', '#7EC8E3')
    infoY += 32
  }
  if (primary.cp) {
    center(`🤝 牵手搭子：${primary.cp.cn}（${primary.cp.code}）· ${primary.cp.line}`, infoY, '22px "PingFang SC", sans-serif', '#FFD966')
    infoY += 32
    center(`🚫 斗篷不合：${primary.rival.cn}（${primary.rival.code}）· ${primary.rival.line}`, infoY, '22px "PingFang SC", sans-serif', '#7EC8E3')
    infoY += 32
  }

  // 分隔光线
  const line = ctx.createLinearGradient(80, 0, W - 80, 0)
  line.addColorStop(0, '#FFD96600')
  line.addColorStop(0.5, '#FFD96666')
  line.addColorStop(1, '#FFD96600')
  ctx.fillStyle = line
  ctx.fillRect(80, infoY + 14, W - 160, 2)

  // 免责声明 + 出品方 + 来源
  ctx.font = '20px "PingFang SC", sans-serif'
  ctx.fillStyle = '#5a6f95'
  const endY = wrapText(ctx, display.disclaimer, W / 2, infoY + 50, W - 140, 28, 'center')
  center('sky墨言·出品', Math.max(endY + 16, infoY + 100), '22px "PingFang SC", sans-serif', '#8BA4CC')
  center(display.shareUrl || '', Math.max(endY + 48, infoY + 132), '22px "PingFang SC", sans-serif', '#FFD966AA')

  // 保存
  const a = document.createElement('a')
  a.download = `SkyTi-${primary.code}.png`
  a.href = canvas.toDataURL('image/png')
  a.click()
  showToast('结果图已保存！')
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, align = 'center') {
  let line = ''
  let yy = y
  const lines = []
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  const saved = ctx.textAlign
  ctx.textAlign = align
  for (const l of lines) {
    ctx.fillText(l, x, yy)
    yy += lineHeight
  }
  ctx.textAlign = saved
  return yy
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'copied-toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}
