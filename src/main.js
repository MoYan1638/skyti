/**
 * SkyTi — 主入口
 */
import { showPage } from './quiz.js'
import { injectSpeedInsights } from '@vercel/speed-insights'

// Initialize Vercel Speed Insights
injectSpeedInsights()

const btnStart = document.getElementById('btn-start')
if (btnStart) btnStart.addEventListener('click', () => showPage('quiz'))
