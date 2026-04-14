/**
 * SkyTi 评分引擎 — 纯函数，无 DOM 依赖
 */

export function calcDimensionScores(answers, questions) {
  const scores = {}
  for (const q of questions) {
    if (answers[q.id] == null) continue
    scores[q.dim] = (scores[q.dim] || 0) + answers[q.id]
  }
  return scores
}

export function scoresToLevels(scores, thresholds) {
  const levels = {}
  for (const [dim, score] of Object.entries(scores)) {
    if (score <= thresholds.L[1]) levels[dim] = 'L'
    else if (score >= thresholds.H[0]) levels[dim] = 'H'
    else levels[dim] = 'M'
  }
  return levels
}

const LEVEL_NUM = { L: 1, M: 2, H: 3 }

export function parsePattern(pattern) {
  return pattern.replace(/-/g, '').split('')
}

export function matchType(userLevels, dimOrder, pattern) {
  const typeLevels = parsePattern(pattern)
  let distance = 0
  let exact = 0
  for (let i = 0; i < dimOrder.length; i++) {
    const userVal = LEVEL_NUM[userLevels[dimOrder[i]]] || 2
    const typeVal = LEVEL_NUM[typeLevels[i]] || 2
    const diff = Math.abs(userVal - typeVal)
    distance += diff
    if (diff === 0) exact++
  }
  const similarity = Math.max(0, Math.round((1 - distance / 30) * 100))
  return { distance, exact, similarity }
}

export function matchAllTypes(userLevels, dimOrder, standardTypes, specialTypes) {
  const results = standardTypes.map(t => {
    const m = matchType(userLevels, dimOrder, t.pattern)
    return { ...t, ...m }
  })

  // 特殊覆盖
  const specialHits = specialTypes.filter(t => t.override).map(t => {
    const m = matchType(userLevels, dimOrder, t.pattern)
    return { ...t, ...m }
  })

  // 排序：精准命中 > 相似度
  results.sort((a, b) => {
    if (b.exact !== a.exact) return b.exact - a.exact
    return b.similarity - a.similarity
  })

  specialHits.forEach(s => {
    if (s.exact === dimOrder.length) {
      results.unshift(s)
    }
  })

  return results
}
