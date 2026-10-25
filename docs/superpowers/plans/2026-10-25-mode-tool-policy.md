# 挑战与闯关道具策略实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 挑战只能用本关免费道具；闯关先用免费次数，再持续消耗背包，无额外使用次数上限。

**Architecture:** 前端统一计算当前入口的可用次数，按钮展示、普通道具和在线重排共用限制；服务端以已保存的对局入口为准，在执行道具前拒绝挑战超额操作。背包仍是账号库存，不按入口复制。

**Tech Stack:** Cocos Creator / TypeScript、Go / Gin、现有对局和资产表。

## 范围

- `standard`（首页三种挑战）只显示并使用本关剩余免费次数，背包再多也不追加。
- `campaign`（闯关）免费次数耗尽后，每次有效操作扣对应背包 1 个，持续使用至库存耗尽；原有操作条件继续有效。
- 挑战超额请求由服务端拒绝，不改牌局、序号、库存或流水；支持免费额度为 0 的关卡。
- 重开/下一关按关卡重新分配免费额度；背包已消耗库存不返还；广告额外槽维持既有独立规则。
- 更新背包及后台说明，避免仍宣称挑战可以消耗背包；当前任务先修改和验证，不主动提交或推送。

## Task 1：服务端执行限制

**Files:** `backend/internal/game/sessions.go`、`backend/internal/httpapi/tool_policy_test.go`，受影响的既有 API 用例。

- [x] 先添加失败测试：四种道具、三种玩法，挑战有免费额度正常使用，耗尽/零额度拒绝且库存不动。
- [x] 服务端在 `state.Tool` 之前用 `session.Entry` 拒绝挑战超过免费额度，不信任客户端入口参数。
- [x] 验证闯关免费后可以连续使用多个背包道具、用完才拒绝；重试同一序号不重复扣、非法操作不扣、重开不返还库存。
- [x] 运行相关后端测试与完整 HTTP API 回归。

## Task 2：前端入口规则和说明

**Files:** `minigame/assets/scripts/StarIsle.ts`、`ui/RewardDialogs.ts`、`admin/src/pages/Levels.tsx`、相关 Node 测试。

- [x] 先复现挑战免费耗尽仍可扣背包、在线重排绕过普通道具分支的问题。
- [x] 增加统一可用次数计算：挑战取免费次数，闯关取免费次数加库存；统一按钮角标和是否可用。
- [x] 普通道具使用及在线重排都检查同一规则，闯关沿用每次扣 1 的库存逻辑。
- [x] 背包说明明确仅闯关消耗库存；后台关卡说明按入口区分，不改变默认免费额度和广告槽行为。

## Task 3：验证和交付

**Files:** `minigame/tools/test-tool-policy-ui.cjs`、`Makefile`、`minigame/README.md`、`README.md`。

- [x] 实际网页包测试：挑战角标不计库存、免费耗尽灰显不扣、闯关显示合计并连续用库存、入口切换与资产刷新。
- [x] 检查类型、格式、规则/在线队列和后端回归，独立复核边界。
- [x] 构建网页和微信小游戏包、验证启动；最终说明需同步更新后端才能强制执行挑战限制。

## 验证记录（2026-10-25）

- RED/GREEN：前端原实现 4 个失败用例、后端原实现 16 个挑战失败案例；修复后专项测试通过。
- `make test-game`：通过，包含 6 个入口策略测试、既有道具/广告槽/资料测试、三种规则和 698 步前后端一致性检查。
- `GIN_MODE=release go test ./... -count=1`：全部通过，包括完整 HTTP API 回归。
- 实际网页包 `test-tool-policy-ui.cjs`：三种挑战的四种道具、闯关连续消耗、按钮数字/禁用、入口切换与资产刷新通过；`smoke-test.cjs` 的 8 个流程通过。
- 小游戏类型检查、相关文件 lint、全仓格式检查、管理后台类型检查和生产构建通过。
- 网页包和微信包构建成功，微信导出资源验证与 6 项启动检查通过；未进行微信真机验证。
- 独立规格与质量复核通过。上线时需同时更新小游戏和后端服务。
