# 实施计划：多渠道架构

批准后按阶段推进；勾选状态随进度更新。P1→P2→P3 顺序执行，P4 按需触发。
**范围调整（用户拍板 2026-10-30）：其他渠道先不搞，先把已有渠道（web + 抖音）搞好——P3 新渠道试点暂缓，其余照常。**

## P1 渠道底座（服务端 + 回归保护）

- [x] 1. 渠道注册表与校验
  - channels.json 注册表 + 启动加载 + 缺省注册 web/douyin_mp
  - report/feedback 的 platform 校验收敛到注册表（缺省 web 兼容；未注册拒绝 unknown_channel）
  - stats/delete 硬编码白名单改读注册表
  - 新增 GET action=channels 公开接口
  - _Requirement: 1, 2, 3, 8
- [x] 2. 分渠道配置体系
  - 新增 GET action=channel_config（全局+渠道合并下发，客户端本地兜底）
  - 新增 POST action=channel（admin upsert：name/enabled/reportEnabled/order/ext）
  - _Requirement: 7, 10
- [x] 3. 回归保护冒烟
  - scripts/smoke-channels：platform 往返保真、未注册拒绝、缺省归 web、fbOnly 不进统计、删除护栏
  - _Requirement: 11, 12

## P2 统计口径显性化 + 看板渠道化

- [x] 4. 统计口径固化
  - summary 支持 ch 切片（缺省全渠道）；口径注释固化三处一致
  - stats 返回渠道名映射、ch 别名参数
  - _Requirement: 4, 5, 6
- [x] 5. 看板渠道化
  - 渠道 Tab / 平台卡片 / 趋势拆线注册表驱动（含「全部」：?view=all 全渠道汇总视图）
  - 渠道管理面板（adminKey）
  - 口径提示文案（说明真实数据为全渠道汇总）
  - _Requirement: 4, 7, 9

## P3 新渠道就绪（暂缓——用户拍板：其他渠道先不搞）

- [ ] 6. 接入契约文档（暂缓）
  - docs/channel-onboarding.md：checklist + adapter 片段（fetch / tt.request / wx.request）
  - _Requirement: 2
- [ ] 7. 首个新渠道试点（暂缓，选型待定）
  - 按契约完成注册→上报→看板自动出现的全链路验证
  - _Requirement: 2, 9

## 部署与终验

- [ ] 8. 部署验证
  - deploy-api.ps1 部署服务端+看板；git push→Vercel 验证网页三端；线上冒烟全绿后收尾
  - _Requirement: 全部

## P4 按需触发（不排期）

- 存储迁移 JSON → SQLite（触发条件：记录 > 5 万或写入冲突）
- 上报限流 / 渠道配额（防刷）
- 跨渠道同人识别（openid/union 映射）
- 渠道级趋势 / 留存分析
