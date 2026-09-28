/**
 * SkyTi v3.0 — 均衡抽题引擎
 * 从 100 题总库按维度均衡抽样，并尽量避免重复出题（localStorage 记录）
 */

const REPEAT_KEY = 'skyti_used_questions_v3'

function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function getUsedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(REPEAT_KEY) || '[]'))
  } catch (e) {
    return new Set()
  }
}

/**
 * 均衡抽样：每轮按维度顺序轮转抽题，保证每个维度覆盖均匀。
 * 优先抽「最近没出过」的题，不足时才回退到用过的题。
 * @param {Array} pool 总题库（questions-pool.json 的 main）
 * @param {number} count 需要的题数
 * @param {string[]} dimOrder 维度顺序
 * @returns {Array} 抽出的题目（乱序）
 */
export function sampleQuestions(pool, count, dimOrder) {
  const byDim = new Map()
  for (const q of pool) {
    if (!byDim.has(q.dim)) byDim.set(q.dim, [])
    byDim.get(q.dim).push(q)
  }

  const used = getUsedIds()
  const fresh = new Map()
  const stale = new Map()
  for (const [dim, arr] of byDim) {
    fresh.set(dim, shuffleArray(arr.filter(q => !used.has(q.id))))
    stale.set(dim, shuffleArray(arr.filter(q => used.has(q.id))))
  }

  const order = dimOrder && dimOrder.length ? dimOrder : [...byDim.keys()]
  const picked = []
  let progressed = true
  while (picked.length < count && progressed) {
    progressed = false
    for (const dim of order) {
      if (picked.length >= count) break
      const q = fresh.get(dim)?.shift() || stale.get(dim)?.shift()
      if (q) {
        picked.push(q)
        progressed = true
      }
    }
  }
  return shuffleArray(picked)
}

/** 记录本次用过的题，供下次抽题时避让 */
export function recordUsedQuestions(picked) {
  try {
    const prev = JSON.parse(localStorage.getItem(REPEAT_KEY) || '[]')
    const merged = [...new Set([...prev, ...picked.map(q => q.id)])]
    // 只保留最近 200 条，防止无限膨胀
    localStorage.setItem(REPEAT_KEY, JSON.stringify(merged.slice(-200)))
  } catch (e) { /* localStorage 不可用时静默跳过 */ }
}
