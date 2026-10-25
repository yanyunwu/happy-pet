# 快乐萌宠消

小游戏、接口和管理后台放在同一个仓库，彼此独立运行。

| 目录        | 内容                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| `minigame/` | Cocos Creator 3.8.8 工程；原生首页、加载场景、美术、音频、规则与微信构建 |
| `admin/`    | React 19.3.1、Ant Design 6.6.7、Vite 8.3.5、TypeScript 7.0.2             |
| `backend/`  | Go 1.26、Gin 1.12、PostgreSQL 18.6、pgx、JWT、bcrypt、sqlc 1.31.1        |
| `scripts/`  | 配置工具、类型检查、界面联调和隔离容器验证                               |

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
3. 在微信后台将对应 API 域名配置为 request 合法域名；当前预览与正式接口均为 `https://hp.autora.cn/api/v1`。需要调整时运行 `make configure-game API_ENV=production API_URL=https://你的域名/api/v1`，然后重新构建小游戏。

小游戏使用 `wx.login` 得到临时 code，服务端调用微信 `jscode2session`，按 OpenID 自动创建或更新同一用户。客户端不能提交 OpenID 或自己的余额，服务端也不接受模拟微信身份。没有 AppSecret 时真实微信登录返回明确的未配置提示。

`minigame/assets/resources/online.json` 保存三组地址，由启动时的微信运行信息自动选择：

| 配置         | 运行场景                                     | 当前 API                       |
| ------------ | -------------------------------------------- | ------------------------------ |
| `local`      | 浏览器、开发者工具模拟器、`develop` 开发版   | `http://127.0.0.1:8080/api/v1` |
| `preview`    | `trial` 体验版                               | `https://hp.autora.cn/api/v1`  |
| `production` | `release` 正式版，或无法识别版本的微信客户端 | `https://hp.autora.cn/api/v1`  |

模拟器使用 `getDeviceInfo().platform` 判断，旧基础库回退到 `getSystemInfoSync()`；版本使用 `getAccountInfoSync().miniProgram.envVersion`。地址由构建时的环境变量或资源 JSON 配置，运行时不读取 Node 的 `process.env`。同一个包自动选取环境；更改地址后需重新构建。[微信官方 API 定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts)

可以单独设置 `API_ENV=local|preview|production` 和 `API_URL`，或一次传入 `API_LOCAL_URL`、`API_PREVIEW_URL`、`API_PRODUCTION_URL`。未指定 `API_ENV` 时，`API_URL` 只更新正式地址；其他环境配置保留。预览、正式地址要求非本机 HTTPS，避免手机连接到本机回环。

微信会自动登录、同步资产并读取已发布关卡；普通网页没有 `wx.login`，首页三种玩法仍可离线练习。离线存档与联网资产分开，离线金币不写入服务器。**手机扫码预览通常也是 `develop`；手机上的 `127.0.0.1` 指向手机自身。真机开发需要把 `local` 改成手机可访问的电脑服务或 HTTPS 测试域名。** 官方定义还说明提交审核默认使用开发版，提交前应确保开发版地址对审核设备可访问。

待上传操作和开局重试标识按 API 地址隔离；预览与正式共用相同地址时共享该接口的待上传队列。旧版未标注地址的记录仅在原本机接口自动迁入，其他地址不会猜测其归属或发送它们。自动化验证使用隔离测试 API 或模拟传输，不代表真实微信登录已验证。

使用 `make build-wechat` 构建时，若 `local` 接口为本机回环地址，会在生成的开发者工具项目中关闭本地域名校验；换成非本机地址并重新构建时会恢复校验。该设置不改变微信正式运行环境的域名要求。

## 当前功能

- 用户管理：微信用户自动入库；搜索、状态筛选、管理账号创建、编辑、停用、恢复、密码管理。停用即撤销已有会话。
- 个人资产：萌宠金币以及撤回、铲出、提示、重排四种背包道具；资产增减有原因、操作者、余额和时间流水，禁止负余额。
- 签到：北京时间每日一次，7 天循环；金币与道具在同一事务发放。
- 首页四个入口：“经典三消”“极限四消”“趣味规则消”属于挑战模式，当前各有连续两关，每轮从第 1 关开始；“闯关模式”单独选择三种规则，按服务器保存的进度继续未通关关卡，失败重试当前关。
- 关卡管理：挑战 / 闯关两个目录共用编辑、预览、草稿、发布和上下架；各自按三消、四消、规则消排列关卡。支持逐层绘制、半格错位、15 种动物数量、免费道具和首通金币。
- 关卡模板：独立管理棋盘行列、层数与格子位置。导入仅复制布局，保留关卡的规则、萌宠数量、奖励和道具；修改或删除模板不影响已有关卡。
- 对局记录：服务端保存初始棋盘、随机种子、关卡版本以及每次选择、撤回、铲出、提示、重排。后台可暂停、逐步、调速和拖动回放。

挑战模式默认每种规则两关：第一关教学，第二关为 108 块、15 种动物、5 层。后台现在可编辑和发布这组关卡，也可在未来扩展后续关卡。闯关模式使用另一组序列，持续发布后续关卡；三种规则的通关记录互相独立，重新进入时选择首个已上架、已发布且尚未通关的关卡。当前全部完成后保留进度，新关卡发布后可继续。四个首页入口共用账号、金币与背包，每个关卡仅首次通关发放奖励。

普通网页或未配置联网地址时，前三种玩法仍使用内置双关进行离线练习；微信联网挑战和闯关都读取后台发布版本。请求关卡期间展示无文字的森林树叶聚合动画，阻止点击且暂停局内计时；成功后进入棋盘，失败后显示可重试的连接提示。

## 关卡配置约定

新关卡使用 `pet-rules-2`，历史 `pet-rules-1` 对局和已发布版本继续兼容：

- `columns` 1–6、`rows` 1–8、`capacity` 固定 7；总牌数 3–192。
- 每层 `z` 为 0–7，数字越大越靠上；每层 `cells` 定义每个方块的左上定位点。
- `x`、`y` 为**半格整数坐标**。偶数表示整格，奇数表示错开半格，例如 `(1, 1)` 比 `(0, 0)` 右移、下移半格。同层两块不能相交。
- 半格换算为横向 48、纵向 47 个游戏设计像素，棋盘居中。高层和低层发生实际覆盖时，低层不可选。
- `rules` 是按优先级排列的组合数组，例如 `[[3],[2,2]]`、`[[4]]`、`[[3,2],[4]]`。每条内部的数字表示**不同种类**各需几个，`[3,2]` 为一种三个、另一种两个；支持 1–6 条，每条合计 2–7 个，禁止重复，行内按降序规范化。`mode` 只决定所属首页入口，不覆盖实际消除规则。
- `counts` 长度 15，顺序对应游戏内 15 个动物；总和必须等于格子数，且能够按实际规则与匹配顺序清空。发布和重排使用有预算的分解及真实逐张消除验证，不只检查数量是否整除。
- 同时满足多条组合时，先采用列表靠前的规则；同一组合按收纳槽中种类首次出现的顺序选择。合法的局中选择仍可能留下无法成组的余牌，重排保持数量，不会凭空补牌。`[[3],[4]]` 中四个同类无法触发，但 `[[3,2],[3]]` 可用合适顺序先凑成五个，优先级不能忽略。
- 生成器将合法消除序列反向分配到可移除路径，保证初始棋盘至少有一条通关路径；发布时还会运行实际规则验证。保证存在解不等于保证玩家每一步都能赢。

修改草稿不会影响已发布内容；发布生成新版本。每局固定引用其开始时的版本，所有历史棋盘快照保留。因此关卡改动后，进行中的对局、奖励和历史回放不会跟着变化。

关卡身份由 `entry + mode + ordinal` 唯一确定，创建后不可变；序号为正整数，不设固定的两关或 9999 关上限。`standard` 是挑战模式的兼容标识，`campaign` 是闯关模式。系统初始化记录表 `system_initializations` 使用通用的 `init_key` 和 `recorded_at`；关卡目录分别记录 `level_catalog:standard`、`level_catalog:campaign`，避免服务重启时复原已调整的目录，也可记录其他初始化任务。

首次部署只保留两份 SQL：`000_schema_migrations.sql` 创建迁移账本，`001_initial.sql` 一次创建全部业务表、约束、索引和预置布局。原增量脚本已经合并；后续结构变更从 `002` 开始新增，不修改已部署的新基线。旧迁移谱系的数据库需要显式核对和转换后再运行此基线，正常启动仍严格验证迁移校验值，不自动重写历史。

布局模板使用 `{columns, rows, layers}`，按相同几何规则验证，不要求格子数能被三或四整除。导入只替换这三个几何字段，保留规则列表、萌宠配比、奖励与道具。模板更新和删除使用 `version` 防止覆盖他人的修改；预置九宫叠层、双层长廊、森林阶梯三种布局。

## 上传、资产与回放

普通选择本地立即执行，后台按序、分批上传；操作队列保存在本机。`sessionId + seq` 保证重复上传不重复执行。断网重试保留原序号，相同序号的不同内容会被拒绝。重排由服务器生成实际结果，客户端再播放顺时针旋转动画。

服务端重新执行所有操作，校验方块可选性、消除结果、槽位、道具余额和终局状态，不直接相信客户端传来的“胜利”。终局操作上传成功就会完成结算，即使玩家在最后动画期间退出；额外结果上报可以安全重试。免费次数先使用，耗尽后才从背包扣减。结算、首次通关和资产流水在事务中处理。

回放展示服务端已验证的每一步棋盘、收纳槽和暂存区，包含重排后的真实布局。操作间隔按客户端相对时间播放，长停顿压缩到 3 秒；不是屏幕录像。未成功上传、且玩家再也没有重新打开客户端的操作，服务器无法恢复。

## API 入口

所有接口前缀为 `/api/v1`，JSON。管理员使用 HttpOnly Cookie，玩家使用 Bearer Token；错误格式为 `{"error":{"code":"...","message":"..."}}`。

| 方法及路径                                        | 作用                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/wechat`                               | `{code}` 微信登录                                                                                                                                                              |
| `GET /user/me`、`GET /user/assets`                | 当前用户和资产                                                                                                                                                                 |
| `POST /user/signin`                               | 每日签到                                                                                                                                                                       |
| `GET /user/levels`                                | 已上架关卡                                                                                                                                                                     |
| `POST /user/sessions`                             | `{entry?, mode, requestId, previousSessionId?}` 开局；standard 为挑战，campaign 为闯关（默认）。挑战新一轮从首关开始，闯关自动续接未通关关卡；前序必须同入口同规则且已赢并结算 |
| `GET /user/sessions/:id`                          | 本人的权威状态及撤回历史                                                                                                                                                       |
| `POST /user/sessions/:id/events`                  | `{events:[{seq,type,tileId?,at}]}` 按序上传，单批最多 64 步                                                                                                                    |
| `POST /user/sessions/:id/finish`                  | `{outcome:"won"                                                                                                                                                                | "lost" | "abandoned"}` 幂等结算 |
| `/admin/users`                                    | 用户列表、编辑、状态与管理账号                                                                                                                                                 |
| `GET/POST /admin/users/:id/assets`                | 查询或调整资产；调整须提供 requestId、asset、delta、reason                                                                                                                     |
| `GET /admin/users/:id/ledger`                     | 最近 100 条资产流水                                                                                                                                                            |
| `GET/POST /admin/levels`、`PUT /admin/levels/:id` | 列表、新建、带 draftVersion 保存草稿                                                                                                                                           |
| `POST /admin/levels/preview`                      | 校验配置并生成固定种子的预览                                                                                                                                                   |
| `POST /admin/levels/:id/publish`、`.../enabled`   | 发布版本、上下架                                                                                                                                                               |
| `GET/POST /admin/level-templates`                 | 布局模板列表、新建，正文为 `{name, layout}`                                                                                                                                    |
| `PUT/DELETE /admin/level-templates/:id`           | 更新正文含 `version`；删除使用 `?version=N`。版本冲突返回 409                                                                                                                  |
| `GET /admin/sessions`、`.../:id/replay`           | 按 entry、规则、用户和结果筛选分页记录，回放保留实际入口                                                                                                                       |

## 验证与容器

```sh
make verify
make lint
make test-browser
make test-startup
make images
```

浏览器联调需先有 `admin/dist` 和 `minigame/build/web-mobile`。测试使用独立随机 PostgreSQL schema，测试结束删除该 schema；容器测试使用独立随机 Compose 项目和临时卷，保留开发数据库。浏览器截图和报告输出到 `artifacts/`。

生产服务由云端平台部署、更新、备份和停止。镜像使用 ACR 的 `failure-plan` 命名空间，仓库为 `happy-pet-backend`、`happy-pet-admin`、`happy-pet-gateway`。云端使用 `compose.prod.yaml` 和 `.env.prod.example` 中的环境变量配置。

Makefile 保留本地开发、检查和镜像构建命令，不再提供生产启动、升级、备份或部署打包入口。网关只绑定 `127.0.0.1:8080`，对外 HTTPS 入口由云端平台配置。镜像、环境变量和 CI 验证说明见 [云端部署说明](docs/deployment.md)。
