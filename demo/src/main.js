/**
 * SkyTi — 主入口
 */
import { showPage } from './quiz.js'

const btnStart = document.getElementById('btn-start')
if (btnStart) btnStart.addEventListener('click', () => showPage('quiz'))
