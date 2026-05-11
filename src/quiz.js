/**
 * SkyTi 鈥?绛旈娴佺▼ + 缁撴灉娓叉煋
 */
import { calcDimensionScores, scoresToLevels, matchAllTypes } from './engine.js'
import { drawRadarChart } from './chart.js'
import questions from '../data/questions.js'
import types from '../data/types.js'
import config from '../data/config.js'

const { standard, special } = types
const { display } = config

// 闅忔満娲楃墝鍑芥暟
function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 姣忔鍔犺浇闅忔満鎶藉彇棰樼洰
const allQuestions = shuffleArray(questions.main)
const dimOrder = ['S1','S2','S3','E1','E2','E3','A1','A2','A3','Ac1','Ac2','Ac3','So1','So2','So3']

let currentIndex = 0
let answers = {}

/* 鈹€鈹€鈹€ 椤甸潰鍒囨崲 鈹€鈹€鈹€ */
export function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-' + id)?.classList.add('active')
  if (id === 'result') renderResult()
}

/* 鈹€鈹€鈹€ 寮€濮?鈹€鈹€鈹€ */
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
    showToast('璇峰厛閫夋嫨涓€涓€夐」')
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

  // 瀵艰埅鎸夐挳鐘舵€?
  const prevBtn = document.getElementById('btn-prev')
  const nextBtn = document.getElementById('btn-next')
  prevBtn.style.visibility = currentIndex > 0 ? 'visible' : 'hidden'
  nextBtn.style.visibility = 'visible'
  nextBtn.textContent = currentIndex < allQuestions.length - 1 ? '涓嬩竴棰?鈫? : '鏌ョ湅缁撴灉 鉁?
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

/* 鈹€鈹€鈹€ 缁撴灉娓叉煋 鈹€鈹€鈹€ */
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

  // 娆¤鍖归厤
  const secondaryEl = document.getElementById('result-secondary')
  if (matched[1]) {
    secondaryEl.style.display = 'block'
    document.getElementById('secondary-info').textContent =
      `${matched[1].cn}锛?{matched[1].code}锛夆€?鐩镐技搴?${matched[1].similarity}%`
  } else {
    secondaryEl.style.display = 'none'
  }

  // 闆疯揪鍥?
  const canvas = document.getElementById('radar-chart')
  const userVec = dimOrder.map(d => ({ L: 1, M: 2, H: 3 }[levels[d]]))
  drawRadarChart(canvas, dimOrder, userVec)

  // 缁村害璇︽儏
  const dimNames = {
    S1:'鍏変箣鑷俊', S2:'鍐呭績娓呮櫚', S3:'鍏変箣杩芥眰',
    E1:'缇佺粖瀹夊叏', E2:'鎯呮劅鎶曞叆', E3:'杈圭晫鐙',
    A1:'绀句氦涓诲姩', A2:'鍖呭鑰愬績', A3:'鏀€姣旂珵浜?,
    Ac1:'鎺㈢储鍐掗櫓', Ac2:'鐩爣瑙勫垝', Ac3:'鏁堢巼杩囩▼',
    So1:'涓诲姩绀句氦', So2:'绀句氦骞垮害', So3:'缁欎簣鍒嗕韩'
  }
  const levelNames = { L: '浣?, M: '涓?, H: '楂? }
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

  // 鍏嶈矗澹版槑
  document.getElementById('disclaimer').textContent = display.disclaimer

  // 鎸夐挳浜嬩欢
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
  a.download = 'SkyTi缁撴灉.png'
  a.href = url
  a.click()
}

function copyAgent() {
  const cmd = 'git clone https://github.com/YOUR_NAME/SkyTi.git && cd SkyTi && npm install && npm run dev'
  navigator.clipboard?.writeText(cmd).then(() => showToast('宸插鍒讹紒'))
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'copied-toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}


