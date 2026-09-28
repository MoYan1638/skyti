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

export function drawRadarChart(canvas, dimOrder, userVec, scale = 1) {
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
    ctx.lineWidth = 2 * scale
    ctx.stroke()

  // 数据点
  for (let i = 0; i < n; i++) {
    const val = userVec[i] / 3
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2
    const x = cx + R * val * Math.cos(angle)
    const y = cy + R * val * Math.sin(angle)
    ctx.beginPath()
    ctx.arc(x, y, 4 * scale, 0, Math.PI * 2)
    ctx.fillStyle = '#FFD966'
    ctx.fill()
    ctx.strokeStyle = '#0d1830'
    ctx.lineWidth = 2 * scale
    ctx.stroke()
  }

  // 标签（两侧边缘自动内收，防止文字被画布裁掉；大类标签带碰撞避让，不再和维度标签重叠）
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const pad = 6 * scale
  const placed = []   // 已放置标签的包围盒 {x, y, w, h}（中心点+宽高）
  const hit = (x, y, w, h) =>
    placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 + 2 * scale &&
                     Math.abs(p.y - y) < (p.h + h) / 2 + 2 * scale)
  const clampX = (x, w) => Math.min(Math.max(x, w / 2 + pad), W - w / 2 - pad)

  // 维度标签（S1、E2 …）
  ctx.font = `${11 * scale}px "PingFang SC", sans-serif`
  ctx.fillStyle = '#8BA4CC'
  const dimH = 12 * scale
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2
    const labelR = R + 18 * scale
    const y = cy + labelR * Math.sin(angle)
    const w = ctx.measureText(dimOrder[i]).width
    const x = clampX(cx + labelR * Math.cos(angle), w)
    ctx.fillText(dimOrder[i], x, y)
    placed.push({ x, y, w, h: dimH })
  }

  // 模型标签（大类：自我/情感/…）——依次尝试更远/上下偏移的位置，避开维度标签
  const modelOrder = ['S', 'E', 'A', 'Ac', 'So']
  modelOrder.forEach((m, mi) => {
    const idx = mi * 3 + 1
    const angle = (Math.PI * 2 * idx / n) - Math.PI / 2
    ctx.font = `bold ${10 * scale}px "PingFang SC", sans-serif`
    ctx.fillStyle = '#FFD96680'
    const w = ctx.measureText(MODEL_LABELS[m]).width
    const h = 11 * scale
    let best = null
    const radii = [34, 52, 70]
    const yOffs = [0, 18, -18, 30, -30]
    outer:
    for (const rr of radii) {
      for (const yo of yOffs) {
        const y = cy + (R + rr * scale) * Math.sin(angle) + yo * scale
        const x = clampX(cx + (R + rr * scale) * Math.cos(angle), w)
        if (x > w / 2 + pad - 1 && x < W - w / 2 - pad + 1 && !hit(x, y, w, h)) {
          best = { x, y }
          break outer
        }
      }
    }
    if (!best) best = { x: clampX(cx + (R + 34 * scale) * Math.cos(angle), w), y: cy + (R + 34 * scale) * Math.sin(angle) }
    ctx.fillText(MODEL_LABELS[m], best.x, best.y)
    placed.push({ x: best.x, y: best.y, w, h })
  })
}
