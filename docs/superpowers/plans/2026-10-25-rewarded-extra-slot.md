# 广告解锁额外收纳槽实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 去掉铲出区提示与背景木槽，右侧增加一个看完激励视频才能解锁、本关有效的收纳槽。

**Architecture:** 七格主槽保留，额外一格作为同一收纳队列的第八格，参与排序和消除。纯规则与服务端事件回放共同维护容量 7/8；微信广告封装只有 `onClose({isEnded:true})` 才返回奖励完成，控制器绑定当前关卡，屏蔽重复点击和过期回调。

**Tech Stack:** Cocos Creator 3.8.8 / TypeScript、微信激励视频、Go / Gin、现有 JSON 对局状态。

## 已确认设计

- 用户确认一次广告增加 1 格，仅当前关卡有效；重开和下一关恢复锁定。
- 广告位尚未创建，配置默认为空；未配置、无广告和浏览器预览均不赠送槽位。
- 上排左侧保留可点击取回的铲出方块，不显示背景槽和说明。最多七张按固定间距排列，右侧独立木槽与主槽最右一格对齐。
- 用户补充：右侧锁定槽参考提供的场记板图片，使用蓝绿色、奶油白、立体圆角的视频图标，不带文字或“+1”。解锁后清除图标，队列第八张方块落在该槽，仍按统一规则消除；不是额外铲出道具。
- 取消、未完整观看无奖励；真实广告异常提供轻提示。广告期间禁止对局输入，离开关卡后不向新关卡发奖。
- 使用客户端官方完整观看回调发出 `unlock_slot` 事件，服务端限制每关一次并持久化容量。此方案不声称提供广告平台服务端验签。

## Task 1：规则和对局事件

**Files:** `minigame/assets/scripts/core/MatchGame.ts`、`OnlineClient.ts`、`backend/internal/game/rules.go`、`sessions.go`，对应规则/API/队列测试。

- [x] 先添加失败测试：默认七格，解锁到八格，重复/结束后拒绝，七张无匹配不输、八张才输，撤回和重排不丢失解锁，新关卡重置。
- [x] 增加 `capacity`、`extraSlotUnlocked` 和 `unlockExtraSlot(): boolean`，云状态只允许 7/8；运行时提示逻辑使用当前容量。
- [x] 增加 `unlock_slot` 事件，沿用持久化队列和序号幂等；服务端在道具分支之前独立处理，不扣背包。
- [x] 验证 TypeScript/Go 规则一致、云恢复保持八格、重试不多加容量，运行相关规则和 API 测试。

## Task 2：微信广告封装

**Files:** 新建 `core/WechatRewardedAd.ts`、`resources/ads.json` 及 Cocos meta，`tools/test-rewarded-ad.cjs`。

- [x] 先测试：完整观看、取消、无结果、错误、加载失败、重复调用、销毁、晚到回调、缺配置/无 SDK。
- [x] 提供 `watch(adUnitId): Promise<boolean>` 与 `destroy()`；只认 `isEnded === true`，禁止分享降级发奖，取消静默，错误抛出面向用户的短提示。
- [x] 清理事件监听，阻止同一实例重复播放，销毁时结束等待并忽略晚到回调。
- [x] 配置 `ads.json.rewardedSlotAdUnitId` 为空；读取失败不阻塞游戏。

## Task 3：铲出区与额外木槽

**Files:** `ui/Layout.ts`、`StarIsle.ts`、`tools/build-woodland-scene.cjs`、`assets/scenes/main.scene`，新增小型槽位组件（若有助隔离绘制）。

- [x] 移除场景中的 `ReservePanel`、`ReserveTitle`，保持 `ReserveTiles` 与点击取回逻辑。
- [x] 用 `RESERVE_X/RESERVE_STEP` 为七张方块预留左侧空间，右侧复用原木纹做独立单槽。
- [x] 用统一 `trayPosition(index)` 映射七格主槽和第八格坐标，更新落位、移动、消除粒子和撤回绘制。
- [x] 点击锁定槽才播放广告；忙碌/动画/弹窗/终局禁止触发；结束回调确认当前关卡身份后解锁与记录。
- [x] HUD 使用动态容量，解锁状态随着云恢复、重开与下一关正确刷新。

## Task 4：集成验证与交付

**Files:** `minigame/tools/test-extra-slot-ui.cjs`、`Makefile`、`minigame/README.md`。

- [x] 实际导出游戏浏览器检查：无旧文字/木槽、七张铲出不碰右槽、窄屏、锁定/解锁图示、广告完成/取消/迟到、八格位置与消除、重开重置。
- [x] 回归现有收纳/铲出/撤回/重排/快速点击用例，检查类型、格式、相关后端测试。
- [x] 构建网页和微信包、运行启动检查，查看截图；说明广告位创建后填入配置并重新构建方可真机播放。
- [x] 自查和独立代码复核，修复发现的问题；当前任务不提交、不推送、不部署。

## 验证记录

- 广告封装 7 项、控制器 4 项、额外槽规则 10 项、在线队列 2 项通过；完整 `make test-game` 通过，包含 698 步前后端规则一致性检查。
- `go -C backend test ./internal/game ./internal/httpapi -count=1` 通过。类型、格式和相关 lint 通过，管理后台构建通过。
- 实际网页包 `test-extra-slot-ui.cjs` 通过，覆盖纯图标、七张铲出间距、广告完成/取消/异常/晚回调、云开局首次点击、云恢复收纳牌、第八格落位及消除、重开、窄屏。
- `test-rapid-input.cjs` 11 个场景和 `smoke-test.cjs` 8 个流程通过。冒烟测试的签到/背包按钮改为读取实际节点位置，修复此前重设计后遗留的旧点击坐标。
- 独立需求复核发现的云开局入口状态已修复，云恢复补齐收纳牌绘制；复核与代码质量审查均通过。
- 网页与微信包重新构建完成，微信导出资源检查及 6 项启动检查通过。最终截图：`minigame/output/qa-extra-slot/slot-detail.png`。
- 广告位 ID 保持空值。正式广告播放待用户创建广告位后配置并真机验证，当前不模拟广告或赠送解锁。
