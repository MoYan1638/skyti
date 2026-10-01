#!/usr/bin/env node
/**
 * SkyTi 站点构建：构建 standard / demo / pro 三端，组装成「一个域名装三个版本」的站点。
 *
 * 产物（写在 standard/dist，也就是线上部署目录）：
 *   dist/index.html    → 自动跳到 /standard/（另附三个版本入口）
 *   dist/standard/**   → 30 题标准版
 *   dist/demo/**       → 15 题快速版
 *   dist/pro/**        → 52 题全维度版
 *
 * 三端各自的 vite.config.js 已把 base 设成 /standard/ /demo/ /pro/。
 *
 * 用法：node scripts/build-site.mjs [--no-install]
 *   --no-install  不自动装依赖（本地已有 node_modules 时本来也会跳过）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const STD = path.join(ROOT, 'standard')
const VERS = ['standard', 'demo', 'pro']
const allowInstall = !process.argv.includes('--no-install')
const log = (m) => console.log(`[build-site] ${m}`)

const ROOT_INDEX = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SkyTi · 光遇人格测试</title>
  <meta name="description" content="MBTI已经过时，SkyTi来了。15/30/52 道题任选，测出你的天空灵魂。" />
  <meta property="og:title" content="SkyTi 光遇人格测试" />
  <meta property="og:description" content="MBTI已经过时，SkyTi来了。测出你的天空灵魂。" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://skyti.moyan06.icu/og-image.png" />
  <meta name="theme-color" content="#060c1a" />
  <link rel="canonical" href="https://skyti.moyan06.icu/standard/" />
  <script>/* 保留 query/hash：老的好友测评链接是根路径带 ?f= 的，不能丢 */location.replace('/standard/' + location.search + location.hash)</script>
  <style>
    body { margin:0; background:#060c1a; color:#e8eefc; font-family:system-ui,-apple-system,"PingFang SC",sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .box { text-align:center; padding:24px; }
    .wing { font-size:44px; }
    h1 { font-size:22px; margin:10px 0 6px; }
    p { color:#8ba4cc; font-size:14px; margin:0 0 18px; }
    a { display:inline-block; margin:6px 0; padding:10px 18px; border-radius:999px; text-decoration:none;
        color:#060c1a; background:#ffd966; font-size:14px; font-weight:600; }
    a.ghost { background:transparent; color:#7ec8e3; border:1px solid #2a3f66; margin-left:8px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="wing">🕯️</div>
    <h1>SkyTi 光遇人格测试</h1>
    <p>正在进入标准版…</p>
    <a href="/standard/">标准版 30 题</a>
    <a class="ghost" href="/demo/">快速版 15 题</a>
    <a class="ghost" href="/pro/">全维度版 52 题</a>
  </div>
</body>
</html>
`

function hasVite(dir) {
  return fs.existsSync(path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'))
}

function ensureDeps(dir, name) {
  if (hasVite(dir)) return true
  if (!allowInstall) {
    log(`${name}: 缺少 node_modules，且已用 --no-install 禁用安装`)
    return false
  }
  log(`${name}: 安装依赖…`)
  const r = spawnSync('npm ci --no-audit --no-fund', { cwd: dir, shell: true, stdio: 'inherit' })
  return r.status === 0
}

function buildVersion(v) {
  const dir = path.join(ROOT, v)
  if (!ensureDeps(dir, v)) return false
  const vite = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js')
  log(`${v}: 构建中…`)
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: dir, encoding: 'utf-8' })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const ok = r.status === 0 && out.includes('built in')
  log(`${v}: ${ok ? '构建成功' : '构建失败'}`)
  if (!ok) console.error(out.slice(-1500))
  return ok
}

/** 把三端产物拼到一个 dist 下，并写根跳转页 */
function assemble() {
  const final = path.join(STD, 'dist')
  const stage = `${final}.stage`
  fs.rmSync(stage, { recursive: true, force: true })
  fs.renameSync(final, stage) // standard 自己的产物先挪开
  fs.mkdirSync(final, { recursive: true })
  fs.renameSync(stage, path.join(final, 'standard'))
  for (const v of ['demo', 'pro']) {
    fs.cpSync(path.join(ROOT, v, 'dist'), path.join(final, v), { recursive: true })
  }
  // 根路径也留一份 OG 图（分享预览用）
  const og = path.join(final, 'standard', 'og-image.png')
  if (fs.existsSync(og)) fs.copyFileSync(og, path.join(final, 'og-image.png'))
  fs.writeFileSync(path.join(final, 'index.html'), ROOT_INDEX, 'utf-8')
  log('组装完成 → standard/dist/{index.html,standard,demo,pro}')
}

const built = VERS.every((v) => buildVersion(v))
if (!built) {
  console.error('[build-site] 有版本构建失败，已中止组装')
  process.exit(1)
}
assemble()
