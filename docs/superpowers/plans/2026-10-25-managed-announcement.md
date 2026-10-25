# 后台公告设置实施计划

> **For agentic workers:** Use subagent-driven-development to execute the independent backend and admin work, then review the integrated feature. Preserve the existing uncommitted rewards/game-club changes.

**Goal:** 管理后台新增设置菜单，将小游戏公告存入通用设置表，小游戏使用较大深黑色纯文字显示后台保存内容。

**Architecture:** PostgreSQL `app_settings` 按键存储 JSON 设置；本次只开放公告这一项。管理端读取和保存需管理员身份；公开接口只返回公告文本，不暴露其他设置。小游戏每次打开公告读取最新内容，长文可滚动，不依赖微信登录。

**Tech Stack:** Go/Gin、PostgreSQL、sqlc、React/Ant Design、Cocos Creator 3.8.8、TypeScript。

## 契约与界面

- 新增迁移 `003_app_settings.sql`；`app_settings` 包含 `key` 主键、`value` JSONB、`version` 正整数和 `updated_at`。键 `announcement` 的值为 `{ "content": "纯文字" }`。首次迁移将原公告文字作为初始正文，只插入一次，不覆盖后来保存的内容。
- `GET /api/v1/admin/settings` 返回 `{ "announcement": string, "version": number, "updatedAt": string }`。
- `PUT /api/v1/admin/settings` 接收 `{ "announcement": string, "version": number }`，成功返回同形设置对象。版本不匹配返回 409，避免覆盖另一位管理员刚保存的内容。正文允许空值，最长 2000 个 Unicode 字符，保留换行，将 CRLF 统一成 LF；拒绝缺字段、非文本及控制字符（允许换行和制表符）。
- `GET /api/v1/settings/announcement` 无需登录，仅返回 `{ "content": string, "updatedAt": string }`；没有通用公开设置列表。
- 后台侧栏增加“设置”，页面只有“更新公告”多行文本框、字数、保存按钮和加载/保存反馈，支持空正文清空公告。沿用现有后台风格与权限会话。
- 小游戏保留“更新公告”木框标题和关闭按钮；移除喇叭、版本标题和新闻卡片。正文固定 32 设计像素、`#171717`、48 行高，左对齐、保留换行、超长时滚动，不能缩小字号塞满。加载时显示“公告加载中…”，空文本显示“暂无公告”，失败显示可重试说明，不回退到旧的硬编码内容。异步结果不能重新打开或覆盖已经关闭/替换的弹窗。

## 执行与验收

- [x] 后端先写接口与迁移回归，观察旧路由失败；实现设置表、sqlc 查询、设置服务与路由。覆盖持久化、重启保留、空值、Unicode 限制、未授权、普通用户写入、跨站来源、并发版本以及公开数据范围。
- [x] 后台实现 `/settings` 页面、菜单与 API 方法；加载失败不允许用空表单覆盖数据，保存失败保留编辑内容，成功以服务端返回版本更新。
- [x] 小游戏先写公开公告读取和弹窗回归；实现请求方法和纯文本滚动区域，验证重新打开刷新、错误重试、空公告、长文、窄屏与关闭后的晚到响应。
- [x] 建立隔离 API 的端到端检查：后台编辑保存、刷新保持、小游戏读取同一文本，普通文本中的 HTML 标记原样显示。
- [x] 运行 sqlc 校验、Go 测试、前后端类型/格式检查、后台构建、小游戏网页构建，审查并截图验收；生成微信包并运行启动检查。

## 范围

不增加富文本编辑、公告列表或定时发布。既有签到、背包与游戏圈改动继续保留。此次只验证隔离测试数据库和本地构建，不改线上公告、不推送或部署。

## 完成记录

- 后端迁移与全部 Go 测试通过，sqlc 生成/校验及代码审查通过；保存使用单条条件更新，8 个并发写入仅一个成功。
- 公开公告单元测试、小游戏浏览器回归通过，覆盖纯文本实体保真、固定黑色字号、长文滚动、关闭/直接替换/销毁及旧请求晚到；个人资料界面回归也通过。
- `make test-announcement-browser` 使用隔离数据库验证真实后台保存、刷新持久化和小游戏读取/再次打开更新/清空。`node scripts/test-settings-form.cjs` 验证加载与保存失败、Unicode 限制、重复提交、版本冲突、移动端及深色主题。
- 后台、网页与微信包构建通过；微信资源与 6 项启动检查通过。截图位于 `artifacts/qa-settings/` 和 `minigame/output/qa-announcement/`。
- 审查发现并修复 Cocos 引号实体二次解码，使用独立同色片段保证后台原文保真；移动布局测试等待响应式侧栏移除后执行，保留严格的横向溢出断言。
