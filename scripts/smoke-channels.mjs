// 渠道隔离冒烟（P1 回归保护）——覆盖 10-30 platform 丢字段事故的回归点
//   1) platform 往返保真   2) 未注册渠道拒绝   3) 缺省 platform 归 web
//   4) summary 全渠道 = 各渠道之和（口径铁律）   5) fbOnly 不进统计、platform 保真
//   6) 删除平台护栏   7) 渠道 upsert + 停用拒收   8) 测试数据清理
// 用法：node scripts/smoke-channels.mjs [https://api.moyan06.icu] [adminKey]   （adminKey 也可用环境变量 SKYTI_KEY）
const BASE = (process.argv[2] || 'https://api.moyan06.icu').replace(/\/+$/, '')
const KEY = process.argv[3] || process.env.SKYTI_KEY || ''
if (!KEY) { console.error('缺少 admin key（第 2 个参数或 SKYTI_KEY 环境变量）'); process.exit(2) }

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')) }
}
const tsBase = Date.now()
const uid = 'usmoke' + tsBase.toString(36)
const post = async (body) => {
  const r = await fetch(BASE + '/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}
const get = async (q) => (await fetch(BASE + '/?' + q)).json()
const K = () => encodeURIComponent(KEY)

async function main() {
  const orig = (await get('action=summary')).total   // 跑之前的原始样本数，清理后应复原

  // 1. 渠道注册表（公开列表 + admin 全量都可用）
  const chs = await get('action=channels&key=' + K())
  ok('channels 返回 web + douyin_mp', chs.ok && Array.isArray(chs.channels) &&
    chs.channels.some(c => c.key === 'web') && chs.channels.some(c => c.key === 'douyin_mp'))
  ok('channels 下发 minSample=300', chs.minSample === 300, 'got ' + chs.minSample)

  // 2. 渠道配置下发
  const cfg1 = await get('action=channel_config&ch=web')
  ok('channel_config(web) 可用', cfg1.ok && cfg1.channel && cfg1.channel.key === 'web')
  const cfg2 = await get('action=channel_config&ch=nope_channel')
  ok('channel_config(未知渠道) 拒绝', cfg2.ok === false && cfg2.error === 'unknown_channel')

  // 3. 注册渠道上报 → platform 往返保真（10-30 事故回归点）
  const tsDy = tsBase + 1
  const r1 = await post({ action: 'report', platform: 'douyin_mp', code: 'SMOKETEST', cn: '冒烟', levels: 'M', v: 'standard', ts: tsDy, uid, feedback: '无反馈' })
  ok('report(douyin_mp) 接受', r1.ok === true, JSON.stringify(r1))
  const dy = await get('action=stats&key=' + K() + '&ch=douyin_mp')
  const hit = (dy.records || []).find(r => Number(r.ts) === tsDy)
  ok('platform 往返保真（douyin_mp 只落抖音端）', hit && hit.platform === 'douyin_mp', hit ? 'platform=' + hit.platform : '记录未找到')

  // 4. 未注册渠道拒绝（防脏数据）
  const before = await get('action=summary')
  const r2 = await post({ action: 'report', platform: 'no_such_channel', code: 'SMOKETEST2', cn: '冒烟', levels: 'M', v: 'standard', ts: tsBase + 2, uid, feedback: '无反馈' })
  ok('未注册渠道拒绝 unknown_channel', r2.ok === false && r2.error === 'unknown_channel', JSON.stringify(r2))
  const after = await get('action=summary')
  ok('被拒记录不进 summary', before.total === after.total)

  // 5. 缺省 platform 归 web（已上线 web 客户端兼容）
  const tsWeb = tsBase + 3
  const r3 = await post({ action: 'report', code: 'SMOKETEST3', cn: '冒烟', levels: 'M', v: 'standard', ts: tsWeb, uid, feedback: '无反馈' })
  ok('缺省 platform 上报接受', r3.ok === true)
  const web = await get('action=stats&key=' + K() + '&ch=web')
  const hitWeb = (web.records || []).find(r => Number(r.ts) === tsWeb)
  ok('缺省 platform 归 web', hitWeb && (hitWeb.platform || 'web') === 'web')

  // 6. 统计口径铁律：summary 全渠道 = 各渠道之和
  const smAll = await get('action=summary')
  const smWeb = await get('action=summary&ch=web')
  const smDy = await get('action=summary&ch=douyin_mp')
  ok('summary 全渠道 = web + douyin_mp', smAll.total === smWeb.total + smDy.total,
    `all=${smAll.total} web=${smWeb.total} dy=${smDy.total}`)

  // 7. fbOnly 独立反馈：不进 summary、platform 保真
  const fbId = 'smoke-fb-' + tsBase
  const r4 = await post({ action: 'feedback', fbId, feedback: '冒烟反馈', uid, platform: 'douyin_mp' })
  ok('独立反馈入库', r4.ok === true, JSON.stringify(r4))
  const sm2 = await get('action=summary')
  ok('fbOnly 不进 summary', sm2.total === smAll.total)
  const dy2 = await get('action=stats&key=' + K() + '&ch=douyin_mp')
  const fbHit = (dy2.records || []).find(r => r.fbId === fbId)
  ok('fbOnly platform 保真', !!(fbHit && fbHit.platform === 'douyin_mp' && fbHit.fbOnly === true))

  // 8. 删除平台护栏：带错渠道删不掉，带对渠道才删得掉
  const wrong = await post({ action: 'delete', key: KEY, platform: 'web', tsList: [tsDy] })
  ok('跨渠道删除被护栏挡住（removed=0）', wrong.ok && wrong.removed === 0, JSON.stringify(wrong))
  const right = await post({ action: 'delete', key: KEY, platform: 'douyin_mp', tsList: [tsDy] })
  ok('本渠道删除生效（removed=1）', right.ok && right.removed === 1, JSON.stringify(right))

  // 9. 渠道 upsert + 停用拒收（smoketest_ch 测完保留停用状态——注册表只增不删）
  const up = await post({ action: 'channel', key: KEY, channelKey: 'smoketest_ch', name: '冒烟测试渠道', enabled: true, reportEnabled: true, order: 999 })
  ok('渠道注册 upsert', up.ok === true, JSON.stringify(up))
  const tsCh = tsBase + 5
  const r5 = await post({ action: 'report', platform: 'smoketest_ch', code: 'SMOKETEST5', cn: '冒烟', levels: 'M', v: 'standard', ts: tsCh, uid, feedback: '无反馈' })
  ok('新注册渠道可上报', r5.ok === true)
  await post({ action: 'channel', key: KEY, channelKey: 'smoketest_ch', name: '冒烟测试渠道', enabled: false, reportEnabled: false, order: 999 })
  const r6 = await post({ action: 'report', platform: 'smoketest_ch', code: 'SMOKETEST6', cn: '冒烟', levels: 'M', v: 'standard', ts: tsBase + 6, uid, feedback: '无反馈' })
  ok('停用渠道拒收 channel_disabled', r6.ok === false && r6.error === 'channel_disabled', JSON.stringify(r6))

  // 10. 清理测试数据 → summary 复原
  await post({ action: 'delete', key: KEY, platform: 'web', tsList: [tsWeb] })
  await post({ action: 'delete', key: KEY, platform: 'douyin_mp', tsList: [Number(fbHit && fbHit.ts)] })
  await post({ action: 'delete', key: KEY, platform: 'smoketest_ch', tsList: [tsCh] })
  const fin = await get('action=summary')
  ok('测试数据清理干净（summary 复原 ' + orig + '）', fin.total === orig, 'now=' + fin.total)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('冒烟脚本异常：' + e.message); process.exit(1) })
