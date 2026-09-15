/**
 * SkyTi — 雷达图（Canvas API）
 */
const MODEL_LABELS = {
  S: '自我',
  E: '情感',
  A: '态度',
  Ac: '行动',
  So: '社交'
}

const LEVEL_COLORS = { L: '#8899bb', M: '#7EC8E3', H: '#FFD966' }

export function drawRadarChart(canvas, dimOrder, userVec) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const cx = W / 2, cy = H / 2
  const R = Math.min(W, H) * 0.38
  const n = dimOrder.length

  ctx.clearRect(0, 0, W, H)

  // 背景圆
  for (let r = 1; r <= 3; r++) {
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2
      const x = cx + (R * r / 3) * Math.cos(angle)
      const y = cy + (R * r / 3) * Math.sin(angle)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = '#1e356040'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 中心到顶点的线
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + R * Math.cos(angle), cy + R * Math.sin(angle))
    ctx.strokeStyle = '#1e356030'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 数据区
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const val = userVec[i] / 3
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2
    const x = cx + R * val * Math.cos(angle)
    const y = cy + R * val * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#FFD96625'
  ctx.fill()
  ctx.strokeStyle = '#FFD966'
  ctx.lineWidth = 2
  ctx.stroke()

  // 数据点
  for (let i = 0; i < n; i++) {
    const val = userVec[i] / 3
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2
    const x = cx + R * val * Math.cos(angle)
    const y = cy + R * val * Math.sin(angle)
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#FFD966'
    ctx.fill()
    ctx.strokeStyle = '#0d1830'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // 标签
  ctx.font = '11px "PingFang SC", sans-serif'
  ctx.fillStyle = '#8BA4CC'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2
    const labelR = R + 18
    const x = cx + labelR * Math.cos(angle)
    const y = cy + labelR * Math.sin(angle)
    ctx.fillText(dimOrder[i], x, y)
  }

  // 模型标签（大类）
  const modelOrder = ['S', 'E', 'A', 'Ac', 'So']
  modelOrder.forEach((m, mi) => {
    const idx = mi * 3 + 1
    const angle = (Math.PI * 2 * idx / n) - Math.PI / 2
    const labelR = R + 32
    const x = cx + labelR * Math.cos(angle)
    const y = cy + labelR * Math.sin(angle)
    ctx.font = 'bold 10px "PingFang SC", sans-serif'
    ctx.fillStyle = '#FFD96680'
    ctx.fillText(MODEL_LABELS[m], x, y)
  })
}
