/**
 * SkyTi — 主入口
 */
import { inject } from '@vercel/analytics'
import { showPage } from './quiz.js'

// Initialize Vercel Analytics
inject()

const btnStart = document.getElementById('btn-start')
if (btnStart) btnStart.addEventListener('click', () => showPage('quiz'))
