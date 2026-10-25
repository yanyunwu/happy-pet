# 快乐萌宠消

小游戏、接口和管理后台放在同一个仓库，彼此独立运行。

| 目录 | 内容 |
| --- | --- |
| `minigame/` | Cocos Creator 3.8.8 工程；原生首页、加载场景、美术、音频、规则与微信构建 |
| `admin/` | React 19.3.1、Ant Design 6.6.7、Vite 8.3.5、TypeScript 7.0.2 |
| `backend/` | Go 1.26、Gin 1.12、PostgreSQL 18.6、pgx、JWT、bcrypt、sqlc 1.31.1 |
| `scripts/` | 配置工具、类型检查、界面联调和隔离容器验证 |

后台沿用 `D:\program\failure-plan` 的布局、绿色主题、深浅模式、移动端抽屉导航、用户管理表格和登录页。Geist 与 Noto Sans SC Variable 字体均本地加载，保留授权文件。参考项目没有被修改，也没有复制其环境配置或业务数据。

## 本地启动

先运行 `make help`。需要 Node 24+、pnpm 11.24、Go 1.26、GNU Make、Git for Windows 的 sh 和 Docker。

```sh
make setup
make dev
```

- 后台：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8080`，健康检查 `/health`
- 独立开发 PostgreSQL：`127.0.0.1:5432`，数据库 `happy_pet`
- 开发 API 和生产网关都使用 8080；在同一台机器切换到生产容器时，先停止本地开发 API。
- 管理账号：`admin`；随机初始密码保存在 **`backend/.env.local`** 的 `ADMIN_PASSWORD`。`make env-init` 保留已有配置和密码。
- 开发数据卷是 `happy-pet_happy_pet_postgres`，不使用参考项目的数据卷。

API 连接数据库后先执行带校验值的连续版本迁移，再启动 HTTP。已发布迁移不可修改，新增结构必须添加下一版本。`make migration-status` 只读查看版本；`make db-down` 仅停止开发数据库、保留数据。

## Cocos 与微信登录

**Cocos Creator 请打开 `D:\program\cocos\xiaochu\minigame`。** 原工程内容已经迁入该目录。旧编辑器若仍开着，应关闭旧工程后重新打开此路径；根目录可能暂时保留旧编辑器占用的 `temp` 日志。旧截图与分析资料保留在 `minigame/output/legacy-artifacts/`，当前构建位于 `minigame/build/`。

```sh
make build-game
make build-wechat
```

微信开发者工具导入 `minigame/build/wechatgame`。保留原 AppID `wx5f84ab7af535815d`、加载插画和 iOS 首屏回调修复。

首次连接真实微信账号需要完成以下配置：

1. 在 `backend/.env.local` 填写该小游戏的 `WECHAT_APP_SECRET`，密钥只在服务端保存。
2. 部署 API 到 HTTPS 域名，在微信后台配置相应的 request 合法域名。
3. 运行 `make configure-game API_URL=https://你的域名/api/v1`，然后重新构建小游戏。

小游戏使用 `wx.login` 得到临时 code，服务端调用微信 `jscode2session`，按 OpenID 自动创建或更新同一用户。客户端不能提交 OpenID 或自己的余额，服务端也不接受模拟微信身份。没有 AppSecret 时真实微信登录返回明确的未配置提示。

`minigame/assets/resources/online.json` 默认接口为空，可继续离线练习。配置接口后微信自动登录、同步资产并读取已发布关卡；网页仍可进入离线练习。离线存档与联网资产分开，离线获得的金币不会写入服务器。本次自动化测试通过隔离测试 API 模拟微信 code 交换，不代表已经完成真实手机微信登录。

## 当前功能

- 用户管理：微信用户自动入库；搜索、状态筛选、管理账号创建、编辑、停用、恢复、密码管理。停用即撤销已有会话。
- 个人资产：萌宠金币以及撤回、铲出、提示、重排四种背包道具；资产增减有原因、操作者、余额和时间流水，禁止负余额。
- 签到：北京时间每日一次，7 天循环；金币与道具在同一事务发放。
- 首页四个入口：“经典三消”“极限四消”“趣味规则消”直接开始各自固定的连续两关；额外的“闯关模式”进入后再选三消 / 四消 / 趣味消，按后台发布的关卡连续前进。各入口开始时说明规则，失败从当前玩法第一关重新开始。
- 关卡管理：逐层绘制、半格错位、15 种动物数量、免费道具次数、首次通关金币奖励、校验预览、保存草稿、发布、上下架。
- 对局记录：服务端保存初始棋盘、随机种子、关卡版本以及每次选择、撤回、铲出、提示、重排。后台可暂停、逐步、调速和拖动回放。

首页三种玩法固定为两关：第一关为教学，第二关为 108 块、15 种动物、5 层。闯关模式另有独立关卡配置，初始也提供每种规则两关，后台可以继续新增第 3 关及更多关卡，不会影响首页三种玩法。联网时四个入口共用账号金币和背包，记录区分入口；每个关卡首次通关奖励只发放一次。

未配置联网地址时，首页三种玩法仍可离线体验；闯关入口显示准备中，不会把离线双关当作后台关卡。后台的关卡编辑、发布和上下架仅作用于闯关模式，固定首页关卡不可通过这些接口修改。

## 关卡配置约定

配置规则版本为 `pet-rules-1`：

- `columns` 1–6、`rows` 1–8、`capacity` 固定 7；总牌数 3–192。
- 每层 `z` 为 0–7，数字越大越靠上；每层 `cells` 定义每个方块的左上定位点。
- `x`、`y` 为**半格整数坐标**。偶数表示整格，奇数表示错开半格，例如 `(1, 1)` 比 `(0, 0)` 右移、下移半格。同层两块不能相交。
- 半格换算为横向 48、纵向 47 个游戏设计像素，棋盘居中。高层和低层发生实际覆盖时，低层不可选。
- `counts` 长度 15，顺序对应游戏内 15 个动物；总和必须等于格子数。三消每种数量为 3 的倍数，四消为 4 的倍数，趣味消通过三同和不同种类两对的分组可行性校验。
- 趣味消先判三同，再判两对。合法的局中选择仍可能导致最后的数量无法成组，这是该玩法现有规则；重排保持数量，不会凭空补牌。
- 生成器将合法消除序列反向分配到可移除路径，保证初始棋盘至少有一条通关路径；发布时还会运行实际规则验证。保证存在解不等于保证玩家每一步都能赢。

修改草稿不会影响已发布内容；发布生成新版本。每局固定引用其开始时的版本，所有历史棋盘快照保留。因此关卡改动后，进行中的对局、奖励和历史回放不会跟着变化。

## 上传、资产与回放

普通选择本地立即执行，后台按序、分批上传；操作队列保存在本机。`sessionId + seq` 保证重复上传不重复执行。断网重试保留原序号，相同序号的不同内容会被拒绝。重排由服务器生成实际结果，客户端再播放顺时针旋转动画。

服务端重新执行所有操作，校验方块可选性、消除结果、槽位、道具余额和终局状态，不直接相信客户端传来的“胜利”。终局操作上传成功就会完成结算，即使玩家在最后动画期间退出；额外结果上报可以安全重试。免费次数先使用，耗尽后才从背包扣减。结算、首次通关和资产流水在事务中处理。

回放展示服务端已验证的每一步棋盘、收纳槽和暂存区，包含重排后的真实布局。操作间隔按客户端相对时间播放，长停顿压缩到 3 秒；不是屏幕录像。未成功上传、且玩家再也没有重新打开客户端的操作，服务器无法恢复。

## API 入口

所有接口前缀为 `/api/v1`，JSON。管理员使用 HttpOnly Cookie，玩家使用 Bearer Token；错误格式为 `{"error":{"code":"...","message":"..."}}`。

| 方法及路径 | 作用 |
| --- | --- |
| `POST /auth/wechat` | `{code}` 微信登录 |
| `GET /user/me`、`GET /user/assets` | 当前用户和资产 |
| `POST /user/signin` | 每日签到 |
| `GET /user/levels` | 已上架关卡 |
| `POST /user/sessions` | `{entry?, mode, requestId, previousSessionId?}` 开局；entry 为 standard（首页双关）或 campaign（闯关，默认），上一关必须属于相同入口、相同规则且已赢并结算 |
| `GET /user/sessions/:id` | 本人的权威状态及撤回历史 |
| `POST /user/sessions/:id/events` | `{events:[{seq,type,tileId?,at}]}` 按序上传，单批最多 64 步 |
| `POST /user/sessions/:id/finish` | `{outcome:"won"|"lost"|"abandoned"}` 幂等结算 |
| `/admin/users` | 用户列表、编辑、状态与管理账号 |
| `GET/POST /admin/users/:id/assets` | 查询或调整资产；调整须提供 requestId、asset、delta、reason |
| `GET /admin/users/:id/ledger` | 最近 100 条资产流水 |
| `GET/POST /admin/levels`、`PUT /admin/levels/:id` | 列表、新建、带 draftVersion 保存草稿 |
| `POST /admin/levels/preview` | 校验配置并生成固定种子的预览 |
| `POST /admin/levels/:id/publish`、`.../enabled` | 发布版本、上下架 |
| `GET /admin/sessions`、`.../:id/replay` | 按 entry、规则、用户和结果筛选分页记录，回放保留实际入口 |

## 验证与容器

```sh
make verify
make lint
make test-browser
make test-startup
make images
make test-deployment
```

浏览器联调需先有 `admin/dist` 和 `minigame/build/web-mobile`。测试使用独立随机 PostgreSQL schema，测试结束删除该 schema；容器测试使用独立随机 Compose 项目和临时卷，保留开发数据库。浏览器截图和报告输出到 `artifacts/`。

生产部署采用镜像拉取方式，沿用参考项目的 ACR 地址，使用独立的 `happy-pet` 命名空间。运行 `make prod-env` 后填写生产配置，再执行 `make registry-login`、`make prod-pull`、`make prod-up`。更新用 `make prod-update`，备份用 `make prod-backup`，停止用 `make prod-stop`，均保留已有数据库卷。

服务器不需要 Node.js、Go 或 Cocos。`make deploy-bundle` 会生成不含密钥和源码的部署包。网关只绑定 `127.0.0.1:8080`，由宿主机 HTTPS 站点提供对外入口。镜像仓库设置、HTTPS、升级、备份恢复和 CI 的完整步骤见 [Docker 部署说明](docs/deployment.md)。
