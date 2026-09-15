/**
 * SkyTi — 答题流程 + 结果渲染
 */
import { calcDimensionScores, scoresToLevels, matchAllTypes } from './engine.js'
import { drawRadarChart } from './chart.js'
import questions from './data/questions.json' assert { type: 'json' }
import types from './data/types.json' assert { type: 'json' }
import config from './data/config.json' assert { type: 'json' }

const { standard, special } = types
const { display } = config

// 随机洗牌函数
function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 每次加载随机抽取题目
const allQuestions = shuffleArray(questions.main)
const dimOrder = ['S1','S2','S3','E1','E2','E3','A1','A2','A3','Ac1','Ac2','Ac3','So1','So2','So3']

let currentIndex = 0
let answers = {}

/* ─── 页面切换 ─── */
export function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-' + id)?.classList.add('active')
  if (id === 'result') renderResult()
}

/* ─── 开始 ─── */
document.getElementById('btn-start')?.addEventListener('click', () => {
  currentIndex = 0
  answers = {}
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
    (currentIndex / allQuestions.length * 100) + '%'
  document.getElementById('progress-text').textContent =
    `${currentIndex + 1} / ${allQuestions.length}`

  const optsEl = document.getElementById('options')
  optsEl.innerHTML = ''
  q.options.forEach(opt => {
    const btn = document.createElement('button')
    btn.className = 'option-btn'
    btn.textContent = opt.label
    btn.addEventListener('click', () => selectOption(q.id, opt.value))
    optsEl.appendChild(btn)
  })

  // 导航按钮状态
  const prevBtn = document.getElementById('btn-prev')
  const nextBtn = document.getElementById('btn-next')
  prevBtn.style.visibility = currentIndex > 0 ? 'visible' : 'hidden'
  nextBtn.style.visibility = 'visible'
  nextBtn.textContent = currentIndex < allQuestions.length - 1 ? '下一题 →' : '查看结果 ✨'
}

function selectOption(qId, value) {
  answers[qId] = value
  if (currentIndex < allQuestions.length - 1) {
    currentIndex++
    renderQuestion()
  } else {
    showPage('result')
  }
}

/* ─── 结果渲染 ─── */
function renderResult() {
  const scores = calcDimensionScores(answers, allQuestions)
  const levels = scoresToLevels(scores, config.scoring.levelThresholds)
  const matched = matchAllTypes(levels, dimOrder, standard, special)
  const primary = matched[0]

  document.getElementById('result-code').textContent = primary.code
  document.getElementById('result-name').textContent = primary.cn
  document.getElementById('result-intro').textContent = primary.intro
  document.getElementById('result-desc').textContent = primary.desc
  document.getElementById('result-badge').textContent = primary.badge || ''

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

  // 按钮事件
  document.getElementById('btn-restart')?.addEventListener('click', restart)
  document.getElementById('btn-download')?.addEventListener('click', downloadResult)
  document.getElementById('btn-agent')?.addEventListener('click', copyAgent)
}

function restart() {
  currentIndex = 0
  answers = {}
  showPage('intro')
}

function downloadResult() {
  const canvas = document.getElementById('radar-chart')
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.download = 'SkyTi结果.png'
  a.href = url
  a.click()
}

function copyAgent() {
  const cmd = 'git clone https://github.com/YOUR_NAME/SkyTi.git && cd SkyTi && npm install && npm run dev'
  navigator.clipboard?.writeText(cmd).then(() => showToast('已复制！'))
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'copied-toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}
