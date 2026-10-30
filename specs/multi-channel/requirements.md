# 需求：api.moyan06.icu 多渠道架构

状态：**待审批**（方案评审中，批准后进入实施）

## 问题与背景

SkyTi 人格测试数据平台（api.moyan06.icu）目前有两个渠道：web 网页端（standard/demo/pro 三站）和抖音小程序端。渠道标识只是记录上的一个自由字符串字段 `platform`，存在三个问题：

1. 渠道白名单 `['web', 'douyin_mp']` 硬编码在 skyti-api.js 三处（report / stats / delete），没有注册、配置、管理的概念，新增渠道要改多处代码。
2. 渠道没有配置能力（启停、上报开关、展示名、排序等），运营无法按渠道管理。
3. 「真实数据展示与统计基于全渠道汇总」已是现状行为（summary 全平台合计、minSample 全局 300），但只是隐式约定，未固化为架构规则，后续扩展容易被破坏（10-30 就发生过 platform 字段被误删导致平台隔离失效的事故）。

目标：把「渠道」升格为一等公民——可注册、可配置、可管理；数据统一存储；对外真实数据展示与统计永远基于全渠道汇总口径。

## 范围

- 服务端 skyti-api.js：渠道注册表、平台校验、配置下发、统计口径
- 看板 stats.html：渠道驱动的 Tab / 卡片 / 管理面板
- 新渠道接入契约（文档 + adapter 约定）
- 回归保护（platform 字段往返冒烟）

不在范围：具体新渠道的客户端实现（仅出契约，试点单独选型）、跨渠道同人识别、存储引擎更换。

## 用户故事

1. 作为平台运营者，我要能注册 / 停用 / 配置渠道，以便新渠道上线和渠道级管理。
2. 作为新渠道开发者，我要一份接入契约（上报格式、真实数据口径、配置拉取），以便一天内完成接入。
3. 作为 C 端用户（任意渠道），我看到的真实稀有度 / 统计数据基于全渠道汇总结果，与我来自哪个渠道无关。
4. 作为看板使用者，我能按渠道切片查看统计，也能看全渠道汇总。
5. 作为平台维护者，渠道字段有校验与回归保护，platform 不会再被静默丢失或误分类。

## 验收标准（EARS）

1. When a client submits report/feedback with a registered `platform` key, the server shall store the record with that `platform` unchanged.
2. When a client submits report/feedback with an unregistered `platform` value, the server shall reject with `unknown_channel` and persist nothing.（现状是「不认识的值归 web」，本需求收紧为拒绝，防脏数据——见设计文档决策 2）
3. While a legacy client omits `platform`, the server shall normalize it to `web`（已上线 web 端不发该字段，必须兼容）。
4. When `GET ?action=summary` is called without a channel filter, the server shall return `total` / `counts` aggregated over all enabled channels excluding `fbOnly`, plus `minSample`.
5. When `GET ?action=summary&ch=<key>` is called, the server shall return aggregates restricted to that channel.
6. When the aggregated global total reaches `minSample`, clients of any channel shall switch to real rarity percentages computed from the global aggregates.（即「所有渠道结果总和累计够 300 切真实数据」）
7. When an admin calls the channel management API with a valid admin key, the server shall upsert registry entries (`name` / `enabled` / `reportEnabled` / `order` / `ext`).
8. While a channel has `enabled: false`, the server shall reject new reports/feedback from it and hide it from the public channel list; historical data remains queryable.
9. When the dashboard loads, channel tabs and platform cards shall be driven by the channel registry (including a 「全部」 global view), not hardcoded.
10. When `GET ?action=channel_config&ch=<key>` is called, the server shall return effective config merged from global + channel scope; clients shall fall back to local config when the request fails.
11. While storing any record (including `fbOnly` feedback entries), the server shall persist `platform` — regression smoke test asserts the report→stats round-trip keeps the field.
12. When deleting records, the delete operation shall remain channel-scoped (platform guardrail preserved).

## 业务规则与约束

- **双层统计口径（核心原则）**：
  - 对外（C 端真实数据展示）= 全渠道汇总（不含 fbOnly），minSample 全局判定达标切真实占比；
  - 对内（看板 / 管理操作）= 按渠道切片（查询、删除、配置均渠道化）。
- 兼容约束：不破坏现有客户端契约（web 不发 platform、抖音发 `douyin_mp`、客户端读 `summary.minSample` 且带本地兜底）。
- 部署链路不变：deploy-api.ps1（服务端+看板）、git push→Vercel（网页三端）、douyinide（小程序）；看板改动走 standard/ → sync_all.py 分发约定。
- 不在代码 / 文档中硬编码 adminKey 与渠道密钥。
- 存储保持单 JSON 文件（当前量级），仅保留迁移路径说明，不预先实现。

## 非目标

- 多租户 / SaaS 化（平台只有一个主体，渠道只是数据维度）
- 分渠道独立存储或分库
- 跨渠道同人识别（openid/union 映射）——留 P4 按需
- 分渠道独立 minSample / 分渠道独立「真实数据」（违背统一汇总需求）
