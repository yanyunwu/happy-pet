---
name: happy-pet-api
description: 使用快乐萌宠消 HTTP API 管理独立管理员账号、玩家、资产、关卡、模板、对局和公告，或集成微信玩家登录与游戏流程。适用于本项目 API 调用和自动化；不用于其他服务。
---

# 快乐萌宠消 API 完整使用指南

这份文件既是可供人阅读的接口手册，也是调用本项目 API 的技能说明。所有字段、流程和接口都在本文件中，不依赖外部说明文件。版本与当前仓库后端路由对应，包含 **56 个 HTTP 操作**。机器可读描述：`GET /api/v1/openapi.json`；管理端交互页面：`/admin/api-docs`；本文公开访问路径：`/admin/SKILL.md`。

## 使用本技能

先确定目标环境、目标账号和用户希望执行的动作；从列表或创建响应取得真实资源 ID。按本文件选择鉴权方式和接口，使用返回的当前版本、请求标识和服务端状态完成操作。只在用户要求的范围内修改账号、资产、关卡或设置。将服务端返回的状态和结果报告给用户，不把示例 ID、示例密码或 Token 占位符当成真实凭证，也不把凭证写入代码、公开文档或日志。

对超时后的重试，先按“幂等与并发”判断原请求是否可能已经成功。对需要操作玩家数据的管理员 Token 调用，明确指定目标玩家；不推断管理员本人也是玩家。

## 目录

1. [地址、请求与错误约定](#地址请求与错误约定)
2. [鉴权与账号边界](#鉴权与账号边界)
3. [快速开始](#快速开始)
4. [分页、幂等与并发](#分页幂等与并发)
5. [关卡配置与单规则约束](#关卡配置与单规则约束)
6. [完整游戏流程](#完整游戏流程)
7. [全部接口](#全部接口)
8. [全部数据结构](#全部数据结构)
9. [维护与验证](#维护与验证)

## 地址、请求与错误约定

- 下文路径为服务端的完整路径，不要再额外拼接一层 `/api/v1`。常规 API 路径为 `/api/v1/...`。
- 本地 Go API 默认 `http://127.0.0.1:8080`；管理端开发服务默认 `http://127.0.0.1:5173`，其 `/api` 代理到后端。生产请使用部署的 HTTPS 站点来源。示例的 `BASE` 不含末尾斜杠。
- 健康检查直连 Go 为 `/health`，统一网关为 `/api/health`。OpenAPI 的该操作提供网关和直连两种 server 选择；在本地管理端开发代理上检查健康时直接访问 Go 的 `/health`。
- 带请求体的操作使用 `Content-Type: application/json`，每次一个 JSON 对象，最多 **1 MiB**。拒绝未知字段、多段 JSON、无法解析的 JSON 或错误字段类型。字段名大小写以本文为准，不发送 `role`、密码哈希等未声明字段。
- 无请求体的操作直接省略请求体。成功结果直接返回对象或数组，没有统一 `data` 包装；204 没有响应体。时间为 RFC 3339（含时区），可空时间显式为 `null`。空数组为 `[]`。
- ID 是服务端分配的不透明字符串；不要由昵称或用户名拼出。新建账号 ID 为 32 位小写十六进制，关卡可能使用预置 ID；`X-User-ID` 只接受 32 位小写十六进制玩家 ID。
- 除健康检查 503 外，业务错误统一为：

```json
{ "error": { "code": "INVALID_INPUT", "message": "请求内容不正确" } }
```

| HTTP    | code                                         | 含义与处理                                             |
| ------- | -------------------------------------------- | ------------------------------------------------------ |
| 400     | INVALID_INPUT                                | 请求、规则或业务前置条件不满足；按 message 修正输入。  |
| 401     | UNAUTHORIZED                                 | 凭证缺失、失效、撤销，或账号已不可用；重新鉴权。       |
| 401     | INVALID_CREDENTIALS                          | 管理员账号/密码或当前密码错误。                        |
| 401     | WECHAT_CODE_INVALID                          | 微信 code 已失效，重新 wx.login。                      |
| 403     | ACCOUNT_DISABLED                             | 登录账号已禁用/删除。                                  |
| 403     | FORBIDDEN                                    | 玩家凭证试图访问其他玩家。                             |
| 403     | ORIGIN_REJECTED                              | Cookie 写请求来源不是配置的管理端来源。                |
| 404     | NOT_FOUND                                    | 路由/资源不存在，或对局不属于目标玩家。                |
| 404     | CAMPAIGN_COMPLETE                            | 当前入口和模式已没有下一可玩关卡；正常结束流程。       |
| 409     | CONFLICT                                     | 版本冲突、幂等键复用冲突、游戏结果不符或资产范围问题。 |
| 409     | LAST_ADMIN                                   | 操作会移除最后一位正常且未删除的管理员。               |
| 429     | TOO_MANY_ATTEMPTS                            | 登录限流；`Retry-After: 300`，等待后再试。             |
| 502/503 | WECHAT_UNAVAILABLE / WECHAT_INVALID_RESPONSE | 微信上游不可用/响应异常或服务未配置。                  |
| 500     | INTERNAL_ERROR                               | 服务异常；保留请求上下文排查，勿假定写请求必然未生效。 |

登录限流分别按微信/管理员类别和客户端 IP 计数，每个类别每 5 分钟最多 30 次。所有 `/api/` 响应设置 `Cache-Control: no-store`。未注册 API 返回 404 的 `NOT_FOUND`。

## 鉴权与账号边界

| 调用场景                            | 凭证                              | 额外条件                                                                  |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| 公开健康、信息、OpenAPI、公告、登录 | 无                                | 登录仍要求自己的请求字段。                                                |
| 管理员 API `/api/v1/admin/*`        | 管理员 Cookie，或管理员访问 Token | Token 通过 `Authorization: Bearer <token>` 传入。                         |
| 玩家 API `/api/v1/user/*`           | 微信登录返回的玩家 JWT            | 只能操作本人；不能利用 `X-User-ID` 切换身份。                             |
| 管理员代表玩家调用玩家 API          | 管理员访问 Token                  | 必须加 `X-User-ID: <正常且未删除的玩家 ID>`；既有归属和游戏规则照常生效。 |

管理员与玩家存储为独立身份。`/admin/accounts` 创建管理员；`/admin/users` 只创建玩家。相同用户名可分别存在于两种身份中；玩家密码不会使其获得管理权。管理员身份不自动拥有玩家资产或游戏进度；旧的管理员登录 JWT 不再作为新管理员会话使用。

管理员登录仅通过 Set-Cookie 返回登录会话，响应 JSON 只有管理员资料。Cookie 名为 `happy_pet_admin_session`，HttpOnly、SameSite=Strict、Path=/api/v1，有效期默认 7 天；Secure 由部署配置决定。Cookie 写请求的非空 Origin 必须等于配置的 ADMIN_ORIGIN，且不能带 `Sec-Fetch-Site: cross-site`。命令行工具可以不发送 Origin。管理员访问 Token 使用显式 Bearer，独立于 Cookie 来源检查；登录接口本身仍校验来源。

**只要出现 Authorization 头，就优先使用它。** 格式错误、空值、重复头、失效 Token 都不能回退到合法 Cookie。一次请求只选一种 Bearer 凭证。玩家 JWT 不可用于管理员 API，管理员会话 JWT 也不等于个人访问 Token。

每位管理员最多一个当前访问 Token。可自动生成 32 字节随机值的 URL-safe Base64 Token（当前实现 43 字符），或设置 32–128 位、无空白的可打印 ASCII 字符。服务端只保存 SHA-256 摘要、前后各四字符的掩码与更新时间。明文仅创建/设置时返回一次；状态接口永不返还旧明文。Token 无固定到期时间，直到轮换、撤销、账号状态变化、删除或密码更改使其失效。普通管理员登出只撤销会话，不撤销访问 Token。

管理员状态变化、删除、密码修改或重置会撤销旧会话和 Token。恢复管理员或玩家都返回 **disabled** 状态，需要显式启用；恢复不会恢复旧凭证。最后一位正常管理员的禁用/删除受事务锁保护，不能通过并发绕过。

玩家 JWT 默认有效 7 天；玩家登出撤销该玩家全部旧 JWT。账号禁用、删除或密码重置也使玩家会话失效。管理员用 Token 代表玩家调用 `/user/logout` 撤销的是目标玩家 JWT，不会撤销管理员 Token。

## 快速开始

下面是 Bash / curl 示例。Windows PowerShell 可使用 `curl.exe` 并将 JSON 写到本地文件后用 `--data-binary @request.json`，避免命令行引号差异。示例值只是占位符；请使用自己的环境和登录响应。

```bash
BASE='http://127.0.0.1:8080'
ADMIN_TOKEN='REPLACE_WITH_ADMIN_ACCESS_TOKEN'
PLAYER_TOKEN='REPLACE_WITH_PLAYER_JWT'
ADMIN_ID='REPLACE_WITH_ADMIN_ID'
PLAYER_ID='REPLACE_WITH_PLAYER_ID'
LEVEL_ID='REPLACE_WITH_LEVEL_ID'
TEMPLATE_ID='REPLACE_WITH_TEMPLATE_ID'
SESSION_ID='REPLACE_WITH_SESSION_ID'
```

先用管理员 Cookie 登录，再生成访问 Token：

```bash
curl -i -c admin-cookies.txt -X POST "$BASE/api/v1/admin/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"username":"YOUR_ADMIN_USERNAME","password":"YOUR_ADMIN_PASSWORD"}'

curl -sS -b admin-cookies.txt -X PUT "$BASE/api/v1/admin/auth/access-token" \
  -H 'Content-Type: application/json' --data '{}'
```

保存第二个响应中的 `accessToken` 到本地安全凭证位置，并将本会话的 `ADMIN_TOKEN` 设为该值。Cookie 文件含登录凭证，勿加入版本库或分享。之后可以列出管理员与玩家：

```bash
curl -sS "$BASE/api/v1/admin/accounts?page=1&pageSize=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
curl -sS "$BASE/api/v1/admin/users?page=1&pageSize=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

使用管理员 Token 调用玩家接口时，明确目标：

```bash
curl -sS "$BASE/api/v1/user/assets" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-User-ID: $PLAYER_ID"
```

若以 Cookie 调用管理接口，把 Bearer 头替换为 `-b admin-cookies.txt`。不要同时保留失效 Bearer 和合法 Cookie。

在 Swagger 页面点 Authorize，仅填入 Token 字符串（不添加 `Bearer ` 前缀），选择 AdminToken 或 PlayerToken。管理员 Token 运行玩家接口时，在该操作的 `X-User-ID` 参数中填目标玩家。Swagger 不持久保存 Token；刷新后重新授权。Try It Out 会执行真实请求，写操作按当前环境实际生效。页面、OpenAPI 和静态资源都从本站加载，不启用外部校验器。该鉴权及请求示例结构遵循 [Swagger OpenAPI 3 鉴权说明](https://swagger.io/docs/specification/v3_0/authentication/) 和 [示例说明](https://swagger.io/docs/specification/v3_0/adding-examples/)。

## 分页、幂等与并发

### 分页

管理员列表、玩家列表、对局记录使用 `{items,total,page,pageSize}`。page 默认 1，无法解析或小于 1 时归 1，超过 100000 为 400。管理员/玩家列表 pageSize 默认 20，小于 1 归 20，大于 100 截为 100；对局列表 pageSize 不在 1..100 内则归 20。超出最后一页返回空 items。账号列表按创建时间倒序；对局按开始时间倒序，ID 作为稳定次序。

账号 q 最长 100 Unicode 字符，对账号/昵称做不区分大小写的模糊查询，也支持 ID 精确查询。`status=deleted` 仅返回回收站，未设置 status 则不含回收站。`source` 仅玩家列表支持。账号 count 和 items 在一致的只读事务中读取；对局分页在并发写入时 total 与当前页可能发生变化。关卡、模板和资产流水不使用该分页契约；流水固定最近 100 条。

### 幂等与重试

| 操作          | 去重/版本范围    | 调用方规则                                                                                   |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| 开始对局      | 玩家 + requestId | 16–80 位字母/数字/_/-；同键同 entry、mode 返回原对局。重试保持整个请求一致；新一局必须新键。 |
| 资产调整      | 玩家 + requestId | 同键的 asset、delta、reason、管理员 actor 都必须相同；重复请求返回当前资产，不再调整。       |
| 游戏事件      | 对局 + seq       | 重复 seq 必须完整动作一致（含 type、tileId、at）；新 seq 连续。                              |
| 结算          | 对局             | 同一 outcome 重复安全；首次通关按玩家+关卡去重发奖。                                         |
| 签到          | 玩家 + 上海日期  | 当日重复和并发只发一次奖励。                                                                 |
| 草稿保存/发布 | draftVersion     | 提交刚读取的当前版本；过期 409，先重新读取并合并。                                           |
| 模板更新/删除 | version          | 更新放 body，删除放 query；过期 409。                                                        |
| 公告保存      | version          | 先 GET 再 PUT；过期 409。                                                                    |

不支持全局 `Idempotency-Key` HTTP 头。账号创建、Token 轮换、发布等不因请求体相同而自动去重。尤其 Token 自动生成请求若超时，重新执行将生成另一 Token；用 Cookie 重新设置并以最后成功响应为准。发布重复执行会产生新的不可变修订版本。先判断原操作的实际结果，不做无边界重试。

开始对局、事件、结算、签到和资产调整在玩家资产行上串行化；同一个玩家多窗口可能争用同一进度。客户端应串行提交同一对局的新动作，等待 lastSeq 确认后再继续。游戏事件批次事务性提交；但终局事件提交与自动结算是两个事务：若响应失败或网络中断，先恢复对局，必要时重试相同事件或调用 finish，不能假定事件未执行。

## 关卡配置与单规则约束

### 入口与模式

`entry` 与 `mode` 是两个不同维度。entry=`standard` 表示挑战，entry=`campaign` 表示持久闯关；未提供 entry 的兼容默认值是 campaign。两者分别有 classic、quartet、fun 目录，关卡唯一键是 entry+mode+ordinal，建后不可更改。

| 行为                      | standard 挑战                  | campaign 闯关                              |
| ------------------------- | ------------------------------ | ------------------------------------------ |
| 无 previousSessionId 开局 | 从该入口/模式最小启用序号开始  | 从持久记录中最早尚未通关的启用关开始       |
| 继续                      | 前序已胜利结算，选更大序号     | 前序若提供必须胜利结算；按尚未通关记录选关 |
| 失败/放弃后再开始         | 新 requestId，可重新从首关挑战 | 新 requestId，仍选最早尚未通关关卡         |
| 免费道具用完              | 直接拒绝，不花背包             | 消耗背包对应道具                           |
| 奖励                      | 每玩家每关首次通关一次         | 每玩家每关首次通关一次                     |

停用或未发布关卡不会被新对局选中；配置发布更新不改写正在进行的对局。服务端负责选关、生成随机 seed、固定 revisionId 和校验结果；客户端不能提交自选奖励或伪造胜利。

### 单个组合的含义

新草稿、预览、发布都要求每关 **恰好一个消除组合**，`rules` 外层仍为数组。例如：

| rules       | 消除条件                                               |
| ----------- | ------------------------------------------------------ |
| `[[3]]`     | 同一种宠物 3 只，经典默认。                            |
| `[[4]]`     | 同一种宠物 4 只，四消默认。                            |
| `[[2,2]]`   | 两种宠物各 2 只或同种 4 只，当前趣味默认；不接受 3+1。 |
| `[[3,2]]`   | 两种宠物分别 3 只、2 只，或同种 5 只。                 |
| `[[3,1]]`   | 两种宠物分别 3 只、1 只，或同种 4 只；不接受 2+2。     |
| `[[2,2,2]]` | 三种各 2 只、两种分别 4 只和 2 只，或同种 6 只。       |
| `[[1,1,1]]` | 任意 3 只，三个组可以是相同或不同宠物种类。            |

每个计数为 1..7 的正整数，组合总数为 2..7，按降序规范化。每个组内部必须同种，不同组可以同种；每个方块只能分配到一个组。先匹配不同种类的原组合，再尝试同种组的合并形式；仍按原有规则数组顺序优先匹配。`[[3],[2,2]]` 是两条组合，**不能用于新的写入**。不要用 mode 名称推测具体匹配逻辑，应读取 rules。

当前推荐 `rulesVersion="pet-rules-2"`，并明确提交 rules。历史快照允许 pet-rules-1，旧快照省略 rules 时保持旧语义（旧 fun 可能同时为三同与双对）；历史多规则按原有优先顺序回放。这是兼容读取能力，不表示新作者接口可保存多规则。不要改写旧对局的 rulesVersion、seed 或规则快照。

### 完整配置校验

- columns=1..6，rows=1..8，layers=1..8；层号 z=0..7 唯一；每层至少一格，总格数 3..192。
- cell.x=0..2*(columns-1)，cell.y=0..2*(rows-1)，整数半格单位。同层两格如果同时 `abs(dx)<2 && abs(dy)<2` 则重叠，不能发布。
- counts 必须恰好 15 个非负整数（索引 0..14 对应 kind），每项不超过 192，总和等于总格数且为 3..192。种类未使用时填 0，不能省掉尾部的零。
- 所有计数必须能被当前组合全部消除。`[[3]]` 各计数为 3 的倍数；`[[4]]` 为 4 的倍数；`[[2,2]]` 各计数为偶数、总数为 4 的倍数，允许单一种类或某种类占多数。
- 其他组合由服务端有界搜索校验；过于复杂或不能完全消除返回 INVALID_INPUT。发布还验证三个种子的实际通关路径，不仅检查数学可分组。
- 配置 capacity 固定为 7。四个 freeTools 键 undo/shovel/hint/shuffle 必须全部存在，各 0..9。rewardCoins=0..10000。
- 草稿保存只立即校验目录、标题、规则与结构上限，允许未配平数量或未完成布局。预览和发布才验证上述全部条件。保存草稿成功不代表可发布。
- 草稿 title 非空，最多 180 UTF-8 字节；模板 name 去空白后 1..180 Unicode 字符。两者长度单位不同。
- 模板仅存 Layout，不携带 mode、rules、counts、freeTools、rewardCoins。

可直接用于预览的最小经典配置：

```json
{
  "rulesVersion": "pet-rules-2",
  "rules": [[3]],
  "mode": "classic",
  "columns": 3,
  "rows": 1,
  "layers": [
    {
      "z": 0,
      "cells": [
        {
          "x": 0,
          "y": 0
        },
        {
          "x": 2,
          "y": 0
        },
        {
          "x": 4,
          "y": 0
        }
      ]
    }
  ],
  "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "capacity": 7,
  "freeTools": {
    "undo": 1,
    "shovel": 1,
    "hint": 3,
    "shuffle": 1
  },
  "rewardCoins": 10
}
```

## 完整游戏流程

1. 用 `wx.login` 得到 code，调用微信登录，保存玩家 accessToken 和 expiresAt；用管理员 Token 调试时先明确 X-User-ID。
2. 按需读取本人资料、资产、公开关卡目录，并执行每日签到。获取的关卡目录是选择展示信息，实际 start 仍由服务端选关。
3. POST sessions，发送新的 requestId、entry、mode。记录返回的 id、revisionId、seed、state 和 lastSeq。
4. 从服务端 state 选择可点击方块。只有没有被更高层覆盖的未移除方块，或 reserve 中的方块可选；tileId=0 是合法 ID。
5. 序号从 lastSeq+1 开始，每批 1..64 个动作。at 是自开局起的相对毫秒、非递减，不能使用 Unix 毫秒时间戳。等待服务端确认后更新客户端状态。
6. state.status=won/lost 时事件接口自动结算。调用 finish 获取 rewardCoins、hasNext、assets；想主动结束 playing 对局则 finish outcome=abandoned。
7. hasNext=true 时用新 requestId 继续；可传已结算胜局的 previousSessionId。返回 CAMPAIGN_COMPLETE 表示当前可玩目录已结束。
8. 网络失败或动作被拒绝后 GET sessions/{id}，使用返回的 lastSeq、state、history 恢复；重放未确认动作时保持原 seq 与内容。不要用新序号掩盖不确定的旧操作。

动作表：

| type        | 效果                                                      | 前置条件/费用                                                      |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| pick        | 方块进入 tray，触发规则匹配，增加 moves                   | 对局 playing，tileId 当前可选；不消耗道具。                        |
| undo        | 回到最近一次 pick 前的棋盘帧                              | 存在撤回历史；最多保留 64 帧；不退还已经消耗的道具。               |
| shovel      | 把 tray 放入 reserve，清空 tray                           | tray 非空，tray+reserve 不超过 7；清空撤回历史。                   |
| hint        | 记录一次提示使用                                          | 还有剩余方块；响应不包含“推荐方块 ID”，客户端自行呈现提示。        |
| shuffle     | 将未消除方块重新布局/分配，并清空 tray、reserve、撤回历史 | playing；使用服务端 seed 与 seq 派生的确定性随机值。               |
| unlock_slot | 将 capacity 从 7 改为 8                                   | 每局仅一次，playing 且当前为 7；不占四种道具次数、不扣背包或金币。 |

四种道具先扣本局免费次数，免费次数耗尽后按入口规则处理。当前额外槽接口没有广告凭证字段，不要虚构广告验证参数。满槽或无剩余可选牌但 tray 未清空会判负；全部牌、tray、reserve 清空才判胜。终局后不能用 undo 复活。放弃后的恢复视图可能 state.status 仍是 playing，但 settled=true；应以结算标志和 finish/审计记录判断。

```bash
curl -sS -X POST "$BASE/api/v1/user/sessions" \
  -H "Authorization: Bearer $PLAYER_TOKEN" -H 'Content-Type: application/json' \
  --data '{"entry":"campaign","mode":"classic","requestId":"demo-game-20261025-0001"}'

# 将响应的 id 设为 SESSION_ID；以下 tileId 必须替换成当前可选方块。
curl -sS -X POST "$BASE/api/v1/user/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $PLAYER_TOKEN" -H 'Content-Type: application/json' \
  --data '{"events":[{"seq":1,"type":"pick","tileId":0,"at":100}]}'

curl -sS "$BASE/api/v1/user/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $PLAYER_TOKEN"

# 仅在仍为 playing 且需要放弃时执行。
curl -sS -X POST "$BASE/api/v1/user/sessions/$SESSION_ID/finish" \
  -H "Authorization: Bearer $PLAYER_TOKEN" -H 'Content-Type: application/json' \
  --data '{"outcome":"abandoned"}'
```

## 全部接口

以下每个操作列出认证、路径/查询参数、请求模型、成功模型、已知错误与 curl。数据模型和全部字段在本文件后半部分；JSON 响应例值只演示形状，不代表固定 ID、余额、时间或棋盘。请求例里的版本必须替换为当前 GET 返回值；账号/关卡创建例不能反复盲目执行。

### 公共

#### 1. 数据库健康检查

`GET /health`

**认证：** 公开接口，无需鉴权。

无请求体。后端直连路径为 /health，统一网关路径为 /api/health。健康响应 200 {status:"ok"}，数据库不可用为 503 {status:"unavailable"}。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [Health](#schema-health)。

**错误：** 503 — 数据库不可用，响应 Health 而非通用 Error。

```bash
curl -sS -X GET "$BASE/health"
```

统一网关使用上方说明的 `$BASE/api/health`；这里的 `$BASE/health` 示例针对直连 Go 服务。

成功响应形状示例：

```json
{ "status": "ok" }
```

#### 2. 应用信息

`GET /api/v1/info`

**认证：** 公开接口，无需鉴权。

无请求体，返回产品名和应用版本。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [Info](#schema-info)。

```bash
curl -sS -X GET "$BASE/api/v1/info"
```

成功响应形状示例：

```json
{ "name": "快乐萌宠消", "version": "0.4.0" }
```

#### 3. 完整 OpenAPI 文档

`GET /api/v1/openapi.json`

**认证：** 公开接口，无需鉴权。

无请求体。返回随二进制内嵌的 OpenAPI 3 文档，不读取数据库；使用当前站点地址和本地引用，无远程校验服务。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [OpenAPIDocument](#schema-openapidocument)。

```bash
curl -sS -X GET "$BASE/api/v1/openapi.json"
```

响应是完整 OpenAPI JSON（包含所有 paths、schemas、securitySchemes 和请求/响应示例），不在这里重复整个机器可读文档。

#### 4. 公开公告

`GET /api/v1/settings/announcement`

**认证：** 公开接口，无需鉴权。

无请求体。content 为空表示暂无公告，updatedAt 为最近更新时间。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [Announcement](#schema-announcement)。

**错误：** 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/settings/announcement"
```

成功响应形状示例：

```json
{ "content": "欢迎来到快乐萌宠消！", "updatedAt": "2026-10-25T08:00:00Z" }
```

### 玩家身份

#### 5. 微信登录

`POST /api/v1/auth/wechat`

**认证：** 公开接口，无需鉴权。

提交 wx.login 新取得的 code。按微信身份注册或复用玩家，返回 Bearer JWT、expiresAt 和玩家资料。会话默认有效 7 天；禁用/删除/登出/密码重置可提前失效。每客户端 IP 每 5 分钟最多 30 次此类登录。

**路径/查询参数：** 无。

**请求体：** [WechatLoginInput](#schema-wechatlogininput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [PlayerSession](#schema-playersession)。

**错误：** 400 — INVALID_INPUT：code 缺失或长度超过 256 字节。 401 — WECHAT_CODE_INVALID：code 失效；重新 wx.login 后再提交。 403 — ACCOUNT_DISABLED：玩家禁用或已删除。 429 — TOO_MANY_ATTEMPTS：登录过于频繁，Retry-After: 300。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。 502 — WECHAT_UNAVAILABLE / WECHAT_INVALID_RESPONSE：上游失败。 503 — WECHAT_UNAVAILABLE：未配置微信登录。

```bash
curl -sS -X POST "$BASE/api/v1/auth/wechat" \
  -H 'Content-Type: application/json' \
  --data '{"code":"REPLACE_WITH_FRESH_WX_LOGIN_CODE"}'
```

成功响应形状示例：

```json
{
  "accessToken": "PLAYER_SESSION_TOKEN_RETURNED_BY_LOGIN",
  "expiresAt": "2026-11-01T08:00:00Z",
  "user": {
    "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "username": "demo-player",
    "nickname": "萌宠玩家",
    "avatarUrl": "",
    "avatarMediaId": "",
    "role": "user",
    "status": "active",
    "source": "manual",
    "createdAt": "2026-10-25T08:00:00Z",
    "updatedAt": "2026-10-25T08:00:00Z",
    "lastLoginAt": null,
    "deletedAt": null
  }
}
```

### 管理员身份

#### 6. 管理员登录

`POST /api/v1/admin/auth/login`

**认证：** 公开接口，无需鉴权。

仅查独立管理员账号。返回 AdminAccount 并写入 HttpOnly、SameSite=Strict 会话 Cookie happy_pet_admin_session（Path=/api/v1，默认 7 天；Secure 依部署配置）。响应 JSON 不含登录 Token。浏览器写入须同源。每 IP 每 5 分钟最多 30 次管理员登录。

**路径/查询参数：** 无。

**请求体：** [AdminLoginInput](#schema-adminlogininput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [AdminAccount](#schema-adminaccount)。

**错误：** 400 — INVALID_INPUT：JSON 或长度不合法。 401 — INVALID_CREDENTIALS：账号/密码不正确。 403 — ACCOUNT_DISABLED / ORIGIN_REJECTED：账号不可用或请求来源被拒绝。 429 — TOO_MANY_ATTEMPTS：Retry-After: 300。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -c admin-cookies.txt -X POST "$BASE/api/v1/admin/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"username":"demo-operator","password":"REPLACE_WITH_YOUR_PASSWORD"}'
```

成功响应形状示例：

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "username": "demo-operator",
  "nickname": "值班管理员",
  "role": "admin",
  "status": "active",
  "remark": "接口演示",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": "2026-10-25T08:00:00Z",
  "deletedAt": null
}
```

#### 7. 当前管理员

`GET /api/v1/admin/auth/me`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体，返回当前 Cookie 会话或访问 Token 对应的管理员资料。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [AdminAccount](#schema-adminaccount)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/auth/me" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "username": "demo-operator",
  "nickname": "值班管理员",
  "role": "admin",
  "status": "active",
  "remark": "接口演示",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": "2026-10-25T08:00:00Z",
  "deletedAt": null
}
```

#### 8. 管理员登出

`POST /api/v1/admin/auth/logout`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。撤销当前管理员全部 Cookie 会话并清除浏览器 Cookie；访问 Token 由专用撤销接口管理。成功 204，无响应体。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 204，无响应体。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/auth/logout" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### 9. 修改本人密码

`POST /api/v1/admin/auth/password`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

需要 currentPassword 与新 password。成功后撤销本人全部会话和访问 Token，并清除 Cookie；必须重新登录。成功 204，无响应体。

**路径/查询参数：** 无。

**请求体：** [ChangePasswordInput](#schema-changepasswordinput)，完整字段见下方同名数据结构。

**成功：** HTTP 204，无响应体。

**错误：** 400 — INVALID_INPUT：新密码不符合 10–72 UTF-8 字节要求。 401 — INVALID_CREDENTIALS / UNAUTHORIZED：当前密码错误或鉴权已失效。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/auth/password" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"currentPassword":"CURRENT_PASSWORD","password":"NEW_PASSWORD_AT_LEAST_10_BYTES"}'
```

#### 10. 查看本人访问 Token 状态

`GET /api/v1/admin/auth/access-token`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。只返回 configured、掩码 hint 和 updatedAt；不会再次读取完整 Token。每个管理员最多一个当前访问 Token。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [AccessTokenMetadata](#schema-accesstokenmetadata)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/auth/access-token" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{ "configured": false, "hint": "", "updatedAt": null }
```

#### 11. 生成或设置本人访问 Token

`PUT /api/v1/admin/auth/access-token`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

提交 {} 或 accessToken:"" 自动生成；自定义 Token 为 32–128 个可打印 ASCII 字符且不含任何空白。完整 Token 仅本响应返回；服务端只保存 SHA-256 摘要与掩码。重新设置即轮换，旧 Token 立即失效。若当前用 Token 调用，本请求仍成功，之后请改用返回的新 Token。

**路径/查询参数：** 无。

**请求体：** [AccessTokenInput](#schema-accesstokeninput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [AccessTokenCreated](#schema-accesstokencreated)。

**错误：** 400 — INVALID_INPUT：自定义 Token 长度或字符不合法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 409 — CONFLICT：Token 已被其他管理员占用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PUT "$BASE/api/v1/admin/auth/access-token" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

成功响应形状示例：

```json
{
  "accessToken": "TOKEN_RETURNED_ONCE_STORE_IN_YOUR_SECRET_STORE",
  "hint": "TOKE…TORE",
  "updatedAt": "2026-10-25T08:00:00Z"
}
```

#### 12. 撤销本人访问 Token

`DELETE /api/v1/admin/auth/access-token`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体，撤销当前访问 Token，成功 204；已无 Token 时重复撤销仍安全。Cookie 会话可继续用于登录管理。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 204，无响应体。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X DELETE "$BASE/api/v1/admin/auth/access-token" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 管理员账号

#### 13. 管理员分页列表

`GET /api/v1/admin/accounts`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

只返回独立管理员表中的账号。q 为账号/昵称筛选；不包含玩家。默认排除软删除记录。 q 对账号/昵称做不区分大小写的模糊匹配，也支持完整 ID 精确匹配；按 createdAt 降序、id 降序。

| 参数       | 位置  | 必填 | 说明                                                                                                              |
| ---------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `q`        | query | 否   | 账号/昵称搜索，最多 100 个 Unicode 字符。 最长字符数 100                                                          |
| `status`   | query | 否   | 省略排除回收站；deleted 仅返回软删除记录。                                                                        |
| `page`     | query | 否   | 页码；无效或小于 1 归 1，最大 100000。 最大 100000；默认 `1`                                                      |
| `pageSize` | query | 否   | 每页条数；玩家/管理员列表无效或小于 1 归 20、大于 100 截为 100；对局列表超范围归 20。 最小 1；最大 100；默认 `20` |

**请求体：** 无。

**成功：** HTTP 200，返回 [AdminPage](#schema-adminpage)。

**错误：** 400 — INVALID_INPUT：非法状态、过大页码或搜索文本。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/accounts?page=1&pageSize=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "items": [
    {
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "username": "demo-operator",
      "nickname": "值班管理员",
      "role": "admin",
      "status": "active",
      "remark": "接口演示",
      "createdAt": "2026-10-25T08:00:00Z",
      "updatedAt": "2026-10-25T08:00:00Z",
      "lastLoginAt": "2026-10-25T08:00:00Z",
      "deletedAt": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

#### 14. 创建管理员

`POST /api/v1/admin/accounts`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

创建正常状态管理员，username 规范化后必须唯一；remark 可省略。返回 201 AdminAccount。不创建玩家身份或资产。

**路径/查询参数：** 无。

**请求体：** [CreateAccountInput](#schema-createaccountinput)，完整字段见下方同名数据结构。

**成功：** HTTP 201，返回 [AdminAccount](#schema-adminaccount)。

**错误：** 400 — INVALID_INPUT：字段不合法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 409 — CONFLICT：管理员账号已存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/accounts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"username":"demo-admin-2","password":"DEMO_PASSWORD_CHANGE_ME","nickname":"第二管理员","remark":"接口演示"}'
```

成功响应形状示例：

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "username": "demo-operator",
  "nickname": "值班管理员",
  "role": "admin",
  "status": "active",
  "remark": "接口演示",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": "2026-10-25T08:00:00Z",
  "deletedAt": null
}
```

#### 15. 读取管理员

`GET /api/v1/admin/accounts/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

路径 id 为管理员 ID；读取单条管理员资料。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [AdminAccount](#schema-adminaccount)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 404 — NOT_FOUND：管理员不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/accounts/$ADMIN_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "username": "demo-operator",
  "nickname": "值班管理员",
  "role": "admin",
  "status": "active",
  "remark": "接口演示",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": "2026-10-25T08:00:00Z",
  "deletedAt": null
}
```

#### 16. 修改管理员资料或状态

`PATCH /api/v1/admin/accounts/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

支持 nickname、status、remark 部分更新；缺省字段保留，至少提供一个非 null 字段，remark:"" 清空。用户名不可改。禁用会撤销目标管理员的会话和访问 Token；不能禁用最后一位正常且未删除的管理员。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [AdminUpdateInput](#schema-adminupdateinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [AdminAccount](#schema-adminaccount)。

**错误：** 400 — INVALID_INPUT：字段或状态不合法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：管理员不存在。 409 — LAST_ADMIN：至少保留一位正常管理员。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PATCH "$BASE/api/v1/admin/accounts/$ADMIN_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"nickname":"值班管理员","status":"active","remark":"本周值班"}'
```

成功响应形状示例：

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "username": "demo-operator",
  "nickname": "值班管理员",
  "role": "admin",
  "status": "active",
  "remark": "接口演示",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": "2026-10-25T08:00:00Z",
  "deletedAt": null
}
```

#### 17. 软删除管理员

`DELETE /api/v1/admin/accounts/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。进入回收站并撤销会话和访问 Token；不会删除玩家历史数据。不能删除最后一位正常管理员。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 204，无响应体。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：账号不存在或已在回收站。 409 — LAST_ADMIN：至少保留一位正常管理员。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X DELETE "$BASE/api/v1/admin/accounts/$ADMIN_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### 18. 恢复管理员

`POST /api/v1/admin/accounts/{id}/restore`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。从回收站恢复为 disabled（禁用）状态；如需重新使用，再 PATCH {status:"active"}。不会恢复旧会话或访问 Token。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [AdminAccount](#schema-adminaccount)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：可恢复的管理员不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/accounts/$ADMIN_ID/restore" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "username": "demo-operator",
  "nickname": "值班管理员",
  "role": "admin",
  "status": "disabled",
  "remark": "接口演示",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": "2026-10-25T08:00:00Z",
  "deletedAt": null
}
```

#### 19. 重置管理员密码

`POST /api/v1/admin/accounts/{id}/password`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无需目标管理员旧密码。设置 10–72 字节新密码并撤销目标全部会话和访问 Token；目标下次必须用新密码登录。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [PasswordInput](#schema-passwordinput)，完整字段见下方同名数据结构。

**成功：** HTTP 204，无响应体。

**错误：** 400 — INVALID_INPUT：密码不合法或目标已删除。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：管理员不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/accounts/$ADMIN_ID/password" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"password":"NEW_PASSWORD_AT_LEAST_10_BYTES"}'
```

### 玩家管理

#### 20. 玩家分页列表

`GET /api/v1/admin/users`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

仅返回玩家，不含管理员账号。q 为账号/昵称搜索；status 省略不显示回收站，source 可筛选 wechat/manual。 q 对账号/昵称做不区分大小写的模糊匹配，也支持完整 ID 精确匹配；按 createdAt 降序、id 降序。

| 参数       | 位置  | 必填 | 说明                                                                                                              |
| ---------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `q`        | query | 否   | 账号/昵称搜索，最多 100 个 Unicode 字符。 最长字符数 100                                                          |
| `status`   | query | 否   | 省略排除回收站；deleted 仅返回软删除记录。                                                                        |
| `page`     | query | 否   | 页码；无效或小于 1 归 1，最大 100000。 最大 100000；默认 `1`                                                      |
| `pageSize` | query | 否   | 每页条数；玩家/管理员列表无效或小于 1 归 20、大于 100 截为 100；对局列表超范围归 20。 最小 1；最大 100；默认 `20` |
| `source`   | query | 否   | 注册来源；省略表示全部。                                                                                          |

**请求体：** 无。

**成功：** HTTP 200，返回 [PlayerPage](#schema-playerpage)。

**错误：** 400 — INVALID_INPUT：状态、来源、查询范围非法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/users?page=1&pageSize=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "items": [
    {
      "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "username": "demo-player",
      "nickname": "萌宠玩家",
      "avatarUrl": "",
      "avatarMediaId": "",
      "role": "user",
      "status": "active",
      "source": "manual",
      "createdAt": "2026-10-25T08:00:00Z",
      "updatedAt": "2026-10-25T08:00:00Z",
      "lastLoginAt": null,
      "deletedAt": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

#### 21. 玩家统计

`GET /api/v1/admin/users/stats`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体；返回未删除玩家的 total、wechat、disabled、today。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [PlayerStats](#schema-playerstats)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/users/stats" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{ "total": 12, "wechat": 10, "disabled": 1, "today": 2 }
```

#### 22. 创建手工玩家

`POST /api/v1/admin/users`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

创建 role=user、source=manual 的正常玩家。此接口不授予管理员权限。手工密码账号不是管理员登录入口；当前公开玩家登录入口是微信。

**路径/查询参数：** 无。

**请求体：** [CreateAccountInput](#schema-createaccountinput)，完整字段见下方同名数据结构。

**成功：** HTTP 201，返回 [Player](#schema-player)。

**错误：** 400 — INVALID_INPUT：字段不合法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 409 — CONFLICT：玩家账号已存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"username":"demo-player","password":"DEMO_PASSWORD_CHANGE_ME","nickname":"测试玩家","remark":"接口演示"}'
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "active",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 23. 读取玩家

`GET /api/v1/admin/users/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

路径 id 为玩家 ID。可读取软删除玩家资料；头像在删除后隐藏。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [Player](#schema-player)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 404 — NOT_FOUND：玩家不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/users/$PLAYER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "active",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 24. 修改玩家资料或状态

`PATCH /api/v1/admin/users/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

需同时提交 nickname、status；remark 省略清空。不能提交 role、username 或其他字段。状态变化会撤销玩家会话。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [UpdateAccountInput](#schema-updateaccountinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Player](#schema-player)。

**错误：** 400 — INVALID_INPUT：字段非法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：玩家不存在或不能更新。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PATCH "$BASE/api/v1/admin/users/$PLAYER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"nickname":"更新后的玩家","status":"active","remark":"已核对资料"}'
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "active",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 25. 软删除玩家

`DELETE /api/v1/admin/users/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。进入回收站并撤销会话；不会抹除资产流水或游戏历史。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 204，无响应体。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：玩家不存在或已在回收站。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X DELETE "$BASE/api/v1/admin/users/$PLAYER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### 26. 恢复玩家

`POST /api/v1/admin/users/{id}/restore`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。恢复回收站中的玩家为 disabled（禁用）状态并再次撤销旧会话；需要重新启用时，再 PATCH 完整 nickname、status:"active"、remark。返回最新 Player。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [Player](#schema-player)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：玩家不存在或不在回收站。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/users/$PLAYER_ID/restore" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "disabled",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 27. 重置玩家密码

`POST /api/v1/admin/users/{id}/password`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

目标必须具有可用的手工 username 且未删除。重置后撤销玩家会话。不会授予管理权限或增加新的公开密码登录端点。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [PasswordInput](#schema-passwordinput)，完整字段见下方同名数据结构。

**成功：** HTTP 204，无响应体。

**错误：** 400 — INVALID_INPUT：密码不合规、纯微信身份或已删除。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：玩家不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/users/$PLAYER_ID/password" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"password":"NEW_PASSWORD_AT_LEAST_10_BYTES"}'
```

### 玩家身份

#### 28. 读取当前玩家资料

`GET /api/v1/user/me`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

无请求体。返回当前玩家资料，隐藏管理员备注。管理员访问 Token 必须显式携带 X-User-ID。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** 无。

**成功：** HTTP 200，返回 [Player](#schema-player)。

**错误：** 400 — INVALID_INPUT：管理员 Token 未提供合法 X-User-ID。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/user/me" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "active",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 29. PATCH 更新玩家资料

`PATCH /api/v1/user/me`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

两个方法行为相同；nickname 必填。avatarUrl 缺失保留原头像，空字符串清除头像和旧媒体引用；null 非法。仅存储经过校验的微信头像 URL，服务端不会下载该图片。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** [ProfileInput](#schema-profileinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Player](#schema-player)。

**错误：** 400 — INVALID_INPUT：昵称或头像地址非法。 管理员 Token 缺少合法 X-User-ID 也返回此状态。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PATCH "$BASE/api/v1/user/me" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"nickname":"小萌宠","avatarUrl":""}'
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "active",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 30. PUT 更新玩家资料

`PUT /api/v1/user/me`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

两个方法行为相同；nickname 必填。avatarUrl 缺失保留原头像，空字符串清除头像和旧媒体引用；null 非法。仅存储经过校验的微信头像 URL，服务端不会下载该图片。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** [ProfileInput](#schema-profileinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Player](#schema-player)。

**错误：** 400 — INVALID_INPUT：昵称或头像地址非法。 管理员 Token 缺少合法 X-User-ID 也返回此状态。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PUT "$BASE/api/v1/user/me" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"nickname":"小萌宠","avatarUrl":""}'
```

成功响应形状示例：

```json
{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "username": "demo-player",
  "nickname": "萌宠玩家",
  "avatarUrl": "",
  "avatarMediaId": "",
  "role": "user",
  "status": "active",
  "source": "manual",
  "createdAt": "2026-10-25T08:00:00Z",
  "updatedAt": "2026-10-25T08:00:00Z",
  "lastLoginAt": null,
  "deletedAt": null
}
```

#### 31. 玩家登出

`POST /api/v1/user/logout`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

无请求体。撤销该玩家所有现有 JWT。管理员用 Token 指定 X-User-ID 调用时撤销的是目标玩家会话，不撤销管理员 Token。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** 无。

**成功：** HTTP 204，无响应体。

**错误：** 400 — INVALID_INPUT：管理员 Token 未提供合法 X-User-ID。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/user/logout" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

### 玩家资产

#### 32. 读取本人资产

`GET /api/v1/user/assets`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

无请求体。返回金币、四种背包道具、累计签到次数和上次签到日期。尚无资产记录时自动初始化为零。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** 无。

**成功：** HTTP 200，返回 [Assets](#schema-assets)。

**错误：** 400 — INVALID_INPUT：管理员 Token 未提供合法 X-User-ID。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/user/assets" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

成功响应形状示例：

```json
{
  "coins": 20,
  "bag": { "undo": 0, "shovel": 0, "hint": 1, "shuffle": 0 },
  "signInCount": 1,
  "signedOn": "2026-10-25"
}
```

#### 33. 每日签到

`POST /api/v1/user/signin`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

无请求体；按 Asia/Shanghai 日期每日最多发奖一次，重复或并发请求不重复发奖。奖励按累计签到次数循环七天，不因断签重置：金币 20/30/40/50/60/80/120；道具依次 hint×1、undo×1、shuffle×1、shovel×1、undo×2、shuffle×2、hint×3。返回最终 Assets。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** 无。

**成功：** HTTP 200，返回 [Assets](#schema-assets)。

**错误：** 400 — INVALID_INPUT：管理员 Token 未提供合法 X-User-ID。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 409 — CONFLICT：发奖后资产将超过上限。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/user/signin" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

成功响应形状示例：

```json
{
  "coins": 20,
  "bag": { "undo": 0, "shovel": 0, "hint": 1, "shuffle": 0 },
  "signInCount": 1,
  "signedOn": "2026-10-25"
}
```

#### 34. 查看指定玩家资产

`GET /api/v1/admin/users/{id}/assets`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。id 为玩家 ID，先检查玩家存在，再读取或初始化资产。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [Assets](#schema-assets)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 404 — NOT_FOUND：玩家不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/users/$PLAYER_ID/assets" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "coins": 20,
  "bag": { "undo": 0, "shovel": 0, "hint": 1, "shuffle": 0 },
  "signInCount": 1,
  "signedOn": "2026-10-25"
}
```

#### 35. 查看玩家资产流水

`GET /api/v1/admin/users/{id}/ledger`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体；返回按 id 降序的最近 100 条流水，无分页参数。没有流水或 id 不存在时返回 []。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [LedgerEntry[]](#schema-ledgerentry)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/users/$PLAYER_ID/ledger" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
[
  {
    "id": 1,
    "asset": "coins",
    "delta": 20,
    "balance": 20,
    "reason": "活动补偿",
    "actorId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "createdAt": "2026-10-25T08:00:00Z"
  }
]
```

#### 36. 调整玩家资产

`POST /api/v1/admin/users/{id}/assets`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

按玩家加锁并写流水。requestId 在该玩家资产调整范围内去重，重试必须保持 asset、delta、reason、操作者完全相同。余额范围 0..1,000,000,000，单次 delta 非零且绝对值不超过 1,000,000。已成功的重复请求返回当前资产，不再次调整。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [AdjustmentInput](#schema-adjustmentinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Assets](#schema-assets)。

**错误：** 400 — INVALID_INPUT：请求标识、数量、原因或资产类型非法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：玩家不存在。 409 — CONFLICT：余额不足/超上限，或相同 requestId 携带不同内容/操作者。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/users/$PLAYER_ID/assets" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"requestId":"demo-adjust-20261025-0001","asset":"coins","delta":20,"reason":"活动补偿"}'
```

成功响应形状示例：

```json
{
  "coins": 20,
  "bag": { "undo": 0, "shovel": 0, "hint": 1, "shuffle": 0 },
  "signInCount": 1,
  "signedOn": "2026-10-25"
}
```

### 游戏对局

#### 37. 已发布可玩关卡目录

`GET /api/v1/user/levels`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

无查询参数，无请求体。仅返回 enabled 且有发布版本的关卡；config 与 title 来自发布快照。按 entry、mode、ordinal 排序。具体下一关由 start 接口根据玩家进度选择。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** 无。

**成功：** HTTP 200，返回 [Level[]](#schema-level)。

**错误：** 400 — INVALID_INPUT：管理员 Token 未提供合法 X-User-ID。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：指定玩家不存在、禁用或已删除。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/user/levels" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

成功响应形状示例：

```json
[
  {
    "id": "dddddddddddddddddddddddddddddddd",
    "entry": "campaign",
    "mode": "classic",
    "ordinal": 100,
    "title": "接口示例关卡",
    "config": {
      "rulesVersion": "pet-rules-2",
      "rules": [[3]],
      "mode": "classic",
      "columns": 3,
      "rows": 1,
      "layers": [
        {
          "z": 0,
          "cells": [
            { "x": 0, "y": 0 },
            { "x": 2, "y": 0 },
            { "x": 4, "y": 0 }
          ]
        }
      ],
      "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "capacity": 7,
      "freeTools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
      "rewardCoins": 10
    },
    "draftVersion": 1,
    "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "enabled": true,
    "updatedAt": "2026-10-25T08:00:00Z"
  }
]
```

#### 38. 开始或继续对局

`POST /api/v1/user/sessions`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

entry 省略默认 campaign；不能自行提交 levelId、seed、奖励或棋盘。requestId 在该玩家全部对局中唯一；同键同 entry+mode 返回原对局（即使当前已结算），不同 entry/mode 为 409。previousSessionId 如提供，必须属于本人、同入口同模式且已胜利结算。standard 按前序关卡 ordinal 继续；省略前序从第一关重新挑战。campaign 根据持久首次通关记录选最早尚未完成的可玩关卡；不传前序也能恢复进度。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** [StartInput](#schema-startinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Session](#schema-session)。

**错误：** 400 — INVALID_INPUT：入口、模式、请求标识或前序归属非法。 管理员 Token 缺少合法 X-User-ID 也返回此状态。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — CAMPAIGN_COMPLETE：该入口/模式当前无可玩下一关。 指定玩家不存在、禁用或已删除也返回此状态。 409 — CONFLICT：幂等键用途变化或前序尚未胜利结算。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/user/sessions" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"entry":"campaign","mode":"classic","requestId":"demo-start-20261025-0001"}'
```

成功响应形状示例：

```json
{
  "entry": "campaign",
  "id": "cccccccccccccccccccccccccccccccc",
  "levelId": "dddddddddddddddddddddddddddddddd",
  "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "ordinal": 100,
  "title": "接口示例关卡",
  "seed": 1,
  "state": {
    "tiles": [
      { "id": 0, "kind": 0, "x": -96, "y": 0, "layer": 0, "removed": false },
      { "id": 1, "kind": 0, "x": 0, "y": 0, "layer": 0, "removed": false },
      { "id": 2, "kind": 0, "x": 96, "y": 0, "layer": 0, "removed": false }
    ],
    "tray": [],
    "reserve": [],
    "matches": 0,
    "cleared": 0,
    "moves": 0,
    "status": "playing",
    "mode": "classic",
    "capacity": 7,
    "tools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rulesVersion": "pet-rules-2",
    "rules": [[3]]
  },
  "lastSeq": 0,
  "settled": false,
  "rewardCoins": 0
}
```

#### 39. 恢复本人对局

`GET /api/v1/user/sessions/{id}`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

无请求体。仅所有者可读取；管理员 Token 也须指定该所有者的 X-User-ID。返回最后确认状态、lastSeq、settled、rewardCoins，并含 state.history（有历史时）供客户端恢复撤回栈。 若对局通过 finish 放弃，settled 为 true，但 state.status 仍可能是 playing；应以 settled 与 finish/审计记录的结果判断，不要继续发新事件。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | path   | 是   | 目标资源 ID；从对应列表或创建响应取得。                                                                                             |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** 无。

**成功：** HTTP 200，返回 [Session](#schema-session)。

**错误：** 400 — INVALID_INPUT：管理员 Token 未提供合法 X-User-ID。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：对局不存在或不属于目标玩家。 指定玩家不存在、禁用或已删除也返回此状态。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/user/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $PLAYER_TOKEN"
```

成功响应形状示例：

```json
{
  "entry": "campaign",
  "id": "cccccccccccccccccccccccccccccccc",
  "levelId": "dddddddddddddddddddddddddddddddd",
  "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "ordinal": 100,
  "title": "接口示例关卡",
  "seed": 1,
  "state": {
    "tiles": [
      { "id": 0, "kind": 0, "x": -96, "y": 0, "layer": 0, "removed": false },
      { "id": 1, "kind": 0, "x": 0, "y": 0, "layer": 0, "removed": false },
      { "id": 2, "kind": 0, "x": 96, "y": 0, "layer": 0, "removed": false }
    ],
    "tray": [],
    "reserve": [],
    "matches": 0,
    "cleared": 0,
    "moves": 0,
    "status": "playing",
    "mode": "classic",
    "capacity": 7,
    "tools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rulesVersion": "pet-rules-2",
    "rules": [[3]]
  },
  "lastSeq": 0,
  "settled": false,
  "rewardCoins": 0
}
```

#### 40. 提交按序游戏动作

`POST /api/v1/user/sessions/{id}/events`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

每批 1–64 个动作，seq 从 1 连续递增；at 为相对毫秒，0..604800000 且非递减；seq 上限 10000。同 seq 同内容可重放，内容不同为 409。一个批次内任何新动作失败都会回滚新动作和道具扣除。只可选择未被覆盖或位于 reserve 的有效方块。先扣本关免费次数；standard 免费次数用完即拒绝，campaign 再扣背包。unlock_slot 不扣道具，只能 playing 且 capacity=7 时解锁一次到 8。最后一步产生 won/lost 时会自动结算；随后仍可调用 finish 获取结算详情。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | path   | 是   | 目标资源 ID；从对应列表或创建响应取得。                                                                                             |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** [EventsInput](#schema-eventsinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [EventResult](#schema-eventresult)。

**错误：** 400 — INVALID_INPUT：批大小/序号/时间/动作/方块/道具/余额或状态非法。 管理员 Token 缺少合法 X-User-ID 也返回此状态。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：对局不存在或属于其他玩家。 指定玩家不存在、禁用或已删除也返回此状态。 409 — CONFLICT：seq 内容冲突、序号跳跃、时间倒退、已结算后追加动作或规则版本无法读取。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/user/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"events":[{"seq":1,"type":"pick","tileId":0,"at":100}]}'
```

成功响应形状示例：

```json
{
  "state": {
    "tiles": [
      { "id": 0, "kind": 0, "x": -96, "y": 0, "layer": 0, "removed": true },
      { "id": 1, "kind": 0, "x": 0, "y": 0, "layer": 0, "removed": false },
      { "id": 2, "kind": 0, "x": 96, "y": 0, "layer": 0, "removed": false }
    ],
    "tray": [0],
    "reserve": [],
    "matches": 0,
    "cleared": 0,
    "moves": 1,
    "status": "playing",
    "mode": "classic",
    "capacity": 7,
    "tools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rulesVersion": "pet-rules-2",
    "rules": [[3]]
  },
  "lastSeq": 1,
  "assets": {
    "coins": 20,
    "bag": { "undo": 0, "shovel": 0, "hint": 1, "shuffle": 0 },
    "signInCount": 1,
    "signedOn": "2026-10-25"
  }
}
```

#### 41. 核验并结算对局

`POST /api/v1/user/sessions/{id}/finish`

**认证：** 玩家 Bearer JWT；或管理员 Bearer 访问 Token + X-User-ID（32 位小写十六进制的正常未删除玩家 ID）。管理员 Cookie 不能直接作为玩家身份，玩家 JWT 不能借 X-User-ID 切换他人。

won/lost 必须与服务端状态一致，不能靠客户端声明胜利。playing 可提交 abandoned；其他状态不可强制改写。相同结果重复结算安全。每玩家每关首次胜利只发一次奖励，奖励固定为开局发布版本的配置，重新发布不会改变正在进行的对局。返回 hasNext 与最新 Assets。

| 参数        | 位置   | 必填 | 说明                                                                                                                                |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | path   | 是   | 目标资源 ID；从对应列表或创建响应取得。                                                                                             |
| `X-User-ID` | header | 否   | 仅在使用管理员访问 Token 时必填。32 位小写十六进制玩家 ID，必须正常且未删除；玩家 JWT 仅可省略或等于本人 ID。 格式 `^[a-f0-9]{32}$` |

**请求体：** [FinishInput](#schema-finishinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [FinishResult](#schema-finishresult)。

**错误：** 400 — INVALID_INPUT：outcome 非法。 管理员 Token 缺少合法 X-User-ID 也返回此状态。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — FORBIDDEN：玩家 JWT 试图指定其他玩家。 404 — NOT_FOUND：对局不存在或归属不符。 指定玩家不存在、禁用或已删除也返回此状态。 409 — CONFLICT：上传结果不符或资产发奖超上限。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/user/sessions/$SESSION_ID/finish" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"outcome":"abandoned"}'
```

成功响应形状示例：

```json
{
  "status": "abandoned",
  "rewardCoins": 0,
  "hasNext": false,
  "assets": {
    "coins": 20,
    "bag": { "undo": 0, "shovel": 0, "hint": 1, "shuffle": 0 },
    "signInCount": 1,
    "signedOn": "2026-10-25"
  }
}
```

### 关卡配置

#### 42. 管理关卡列表

`GET /api/v1/admin/levels`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体、无分页。包含所有入口/模式的草稿、已发布引用与启用状态；config 为草稿，可能尚未通过发布校验。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [Level[]](#schema-level)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/levels" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
[
  {
    "id": "dddddddddddddddddddddddddddddddd",
    "entry": "campaign",
    "mode": "classic",
    "ordinal": 100,
    "title": "接口示例关卡",
    "config": {
      "rulesVersion": "pet-rules-2",
      "rules": [[3]],
      "mode": "classic",
      "columns": 3,
      "rows": 1,
      "layers": [
        {
          "z": 0,
          "cells": [
            { "x": 0, "y": 0 },
            { "x": 2, "y": 0 },
            { "x": 4, "y": 0 }
          ]
        }
      ],
      "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "capacity": 7,
      "freeTools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
      "rewardCoins": 10
    },
    "draftVersion": 1,
    "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "enabled": true,
    "updatedAt": "2026-10-25T08:00:00Z"
  }
]
```

#### 43. 创建关卡草稿

`POST /api/v1/admin/levels`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

创建草稿返回 200。entry 省略默认为 campaign，entry+mode+ordinal 必须唯一，config.mode 必须等于 mode。新写入的规则必须恰好一个消除组合。草稿可暂存尚未配平的数量或未完成布局；最多 8 层、15 种计数，序列化配置不超过 60000 字节。

**路径/查询参数：** 无。

**请求体：** [DraftInput](#schema-draftinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Level](#schema-level)。

**错误：** 400 — INVALID_INPUT：元信息、单规则或草稿规模非法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 409 — CONFLICT：同入口/模式/序号已存在或保存冲突。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/levels" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"entry":"campaign","mode":"classic","ordinal":100,"title":"接口示例关卡","config":{"rulesVersion":"pet-rules-2","rules":[[3]],"mode":"classic","columns":3,"rows":1,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0}]}],"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"capacity":7,"freeTools":{"undo":1,"shovel":1,"hint":3,"shuffle":1},"rewardCoins":10}}'
```

成功响应形状示例：

```json
{
  "id": "dddddddddddddddddddddddddddddddd",
  "entry": "campaign",
  "mode": "classic",
  "ordinal": 100,
  "title": "接口示例关卡",
  "config": {
    "rulesVersion": "pet-rules-2",
    "rules": [[3]],
    "mode": "classic",
    "columns": 3,
    "rows": 1,
    "layers": [
      {
        "z": 0,
        "cells": [
          { "x": 0, "y": 0 },
          { "x": 2, "y": 0 },
          { "x": 4, "y": 0 }
        ]
      }
    ],
    "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "capacity": 7,
    "freeTools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rewardCoins": 10
  },
  "draftVersion": 1,
  "revisionId": "",
  "enabled": false,
  "updatedAt": "2026-10-25T08:00:00Z"
}
```

#### 44. 更新关卡草稿

`PUT /api/v1/admin/levels/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

完整提交 DraftInput 和当前 draftVersion。保存成功版本递增。entry、mode、ordinal 建后不可变；已有发布版本及运行中对局保持快照。409 后先重新读取并合并，不可盲目强制覆盖。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [DraftInput](#schema-draftinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Level](#schema-level)。

**错误：** 400 — INVALID_INPUT：改变不可变目录字段、单规则或草稿非法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：关卡不存在。 409 — CONFLICT：草稿版本已改变或保存冲突。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PUT "$BASE/api/v1/admin/levels/$LEVEL_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"entry":"campaign","mode":"classic","ordinal":100,"title":"接口示例关卡（更新）","config":{"rulesVersion":"pet-rules-2","rules":[[3]],"mode":"classic","columns":3,"rows":1,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0}]}],"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"capacity":7,"freeTools":{"undo":1,"shovel":1,"hint":3,"shuffle":1},"rewardCoins":10},"draftVersion":1}'
```

成功响应形状示例：

```json
{
  "id": "dddddddddddddddddddddddddddddddd",
  "entry": "campaign",
  "mode": "classic",
  "ordinal": 100,
  "title": "接口示例关卡",
  "config": {
    "rulesVersion": "pet-rules-2",
    "rules": [[3]],
    "mode": "classic",
    "columns": 3,
    "rows": 1,
    "layers": [
      {
        "z": 0,
        "cells": [
          { "x": 0, "y": 0 },
          { "x": 2, "y": 0 },
          { "x": 4, "y": 0 }
        ]
      }
    ],
    "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "capacity": 7,
    "freeTools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rewardCoins": 10
  },
  "draftVersion": 2,
  "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "enabled": true,
  "updatedAt": "2026-10-25T08:00:00Z"
}
```

#### 45. 发布关卡快照

`POST /api/v1/admin/levels/{id}/publish`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

请求体为 {draftVersion:当前版本}。锁定关卡核对版本，完整校验布局、计数、规则、道具和奖励，并验证种子 1、2、3 的实际可通关路径。成功创建不可变 revisionId 且自动启用。正在进行的对局仍使用自己的 revisionId。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** JSON 对象。

| 字段           | 类型    | 必填 | 说明   |
| -------------- | ------- | ---- | ------ |
| `draftVersion` | integer | 是   | 最小 1 |

**成功：** HTTP 200，返回 [Level](#schema-level)。

**错误：** 400 — INVALID_INPUT：配置无法发布（见关卡规则章节）。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：关卡不存在。 409 — CONFLICT：草稿版本变化。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/levels/$LEVEL_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"draftVersion":1}'
```

成功响应形状示例：

```json
{
  "id": "dddddddddddddddddddddddddddddddd",
  "entry": "campaign",
  "mode": "classic",
  "ordinal": 100,
  "title": "接口示例关卡",
  "config": {
    "rulesVersion": "pet-rules-2",
    "rules": [[3]],
    "mode": "classic",
    "columns": 3,
    "rows": 1,
    "layers": [
      {
        "z": 0,
        "cells": [
          { "x": 0, "y": 0 },
          { "x": 2, "y": 0 },
          { "x": 4, "y": 0 }
        ]
      }
    ],
    "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "capacity": 7,
    "freeTools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rewardCoins": 10
  },
  "draftVersion": 1,
  "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "enabled": true,
  "updatedAt": "2026-10-25T08:00:00Z"
}
```

#### 46. 启停关卡

`POST /api/v1/admin/levels/{id}/enabled`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

请求体 {enabled:true|false}。启用前必须存在发布版本。停用使新对局跳过该关；不改写已开始的对局快照。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** JSON 对象。

| 字段      | 类型    | 必填 | 说明 |
| --------- | ------- | ---- | ---- |
| `enabled` | boolean | 是   |      |

**成功：** HTTP 200，返回 [OK](#schema-ok)。

**错误：** 400 — INVALID_INPUT：启用未发布关卡。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：关卡不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/levels/$LEVEL_ID/enabled" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"enabled":true}'
```

成功响应形状示例：

```json
{ "ok": true }
```

#### 47. 预览确定性棋盘

`POST /api/v1/admin/levels/preview`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

请求体 {config,seed}。使用完整有效的单规则配置与 uint32 seed，返回公开棋盘；不会创建对局、扣资产或发布。相同配置+seed 生成相同棋盘，不能将预览当作正式对局结果提交。

**路径/查询参数：** 无。

**请求体：** JSON 对象。

| 字段     | 类型                                       | 必填 | 说明                                |
| -------- | ------------------------------------------ | ---- | ----------------------------------- |
| `config` | [AuthoringConfig](#schema-authoringconfig) | 是   |                                     |
| `seed`   | integer                                    | 是   | 最小 0；最大 4294967295；格式 int64 |

**成功：** HTTP 200，返回 [State](#schema-state)。

**错误：** 400 — INVALID_INPUT：无效规则/配置/种子，或生成器无法构建可通关路径。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/levels/preview" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"config":{"rulesVersion":"pet-rules-2","rules":[[3]],"mode":"classic","columns":3,"rows":1,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0}]}],"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"capacity":7,"freeTools":{"undo":1,"shovel":1,"hint":3,"shuffle":1},"rewardCoins":10},"seed":1}'
```

成功响应形状示例：

```json
{
  "tiles": [
    { "id": 0, "kind": 0, "x": -96, "y": 0, "layer": 0, "removed": false },
    { "id": 1, "kind": 0, "x": 0, "y": 0, "layer": 0, "removed": false },
    { "id": 2, "kind": 0, "x": 96, "y": 0, "layer": 0, "removed": false }
  ],
  "tray": [],
  "reserve": [],
  "matches": 0,
  "cleared": 0,
  "moves": 0,
  "status": "playing",
  "mode": "classic",
  "capacity": 7,
  "tools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
  "rulesVersion": "pet-rules-2",
  "rules": [[3]]
}
```

### 布局模板

#### 48. 列出布局模板

`GET /api/v1/admin/level-templates`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体、无分页；按更新时间降序、ID 排序。只复用几何，模板没有规则、宠物数量、道具或奖励。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [Template[]](#schema-template)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/level-templates" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
[
  {
    "id": "dddddddddddddddddddddddddddddddd",
    "name": "三格横排",
    "layout": {
      "columns": 3,
      "rows": 1,
      "layers": [
        {
          "z": 0,
          "cells": [
            { "x": 0, "y": 0 },
            { "x": 2, "y": 0 },
            { "x": 4, "y": 0 }
          ]
        }
      ]
    },
    "version": 1,
    "updatedAt": "2026-10-25T08:00:00Z"
  }
]
```

#### 49. 创建布局模板

`POST /api/v1/admin/level-templates`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

名称去空白后 1–180 个 Unicode 字符；完整校验 Layout。创建返回 200，version 从 1 开始；创建输入的 version 不参与并发检查。

**路径/查询参数：** 无。

**请求体：** [TemplateInput](#schema-templateinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Template](#schema-template)。

**错误：** 400 — INVALID_INPUT：名称或布局无效。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X POST "$BASE/api/v1/admin/level-templates" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"三格横排","layout":{"columns":3,"rows":1,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0}]}]}}'
```

成功响应形状示例：

```json
{
  "id": "dddddddddddddddddddddddddddddddd",
  "name": "三格横排",
  "layout": {
    "columns": 3,
    "rows": 1,
    "layers": [
      {
        "z": 0,
        "cells": [
          { "x": 0, "y": 0 },
          { "x": 2, "y": 0 },
          { "x": 4, "y": 0 }
        ]
      }
    ]
  },
  "version": 1,
  "updatedAt": "2026-10-25T08:00:00Z"
}
```

#### 50. 更新布局模板

`PUT /api/v1/admin/level-templates/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

必须提交当前 version、name、layout；保存成功 version 递增。不改变先前复制该模板创建的关卡。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** [TemplateInput](#schema-templateinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Template](#schema-template)。

**错误：** 400 — INVALID_INPUT：名称、布局或版本无效。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：模板不存在。 409 — CONFLICT：模板版本过期。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PUT "$BASE/api/v1/admin/level-templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"三格横排（更新）","layout":{"columns":3,"rows":1,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0}]}]},"version":1}'
```

成功响应形状示例：

```json
{
  "id": "dddddddddddddddddddddddddddddddd",
  "name": "三格横排",
  "layout": {
    "columns": 3,
    "rows": 1,
    "layers": [
      {
        "z": 0,
        "cells": [
          { "x": 0, "y": 0 },
          { "x": 2, "y": 0 },
          { "x": 4, "y": 0 }
        ]
      }
    ]
  },
  "version": 2,
  "updatedAt": "2026-10-25T08:00:00Z"
}
```

#### 51. 删除布局模板

`DELETE /api/v1/admin/level-templates/{id}`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体；必须通过 query version 提供当前版本。成功返回 200 {ok:true}，不影响使用过此几何的关卡。

| 参数      | 位置  | 必填 | 说明                                    |
| --------- | ----- | ---- | --------------------------------------- |
| `id`      | path  | 是   | 目标资源 ID；从对应列表或创建响应取得。 |
| `version` | query | 是   | 当前模板版本。 最小 1                   |

**请求体：** 无。

**成功：** HTTP 200，返回 [OK](#schema-ok)。

**错误：** 400 — INVALID_INPUT：缺少或无效版本。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 404 — NOT_FOUND：模板不存在。 409 — CONFLICT：模板已被其他人修改。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X DELETE "$BASE/api/v1/admin/level-templates/$TEMPLATE_ID?version=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{ "ok": true }
```

### 对局审计

#### 52. 分页查询对局

`GET /api/v1/admin/sessions`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

按 startedAt 降序、id 降序。可组合 userId、entry、mode、status 精确筛选。status=abandoned 是已放弃记录。pageSize 超出 1..100 时归 20。

| 参数       | 位置  | 必填 | 说明                                                                                                              |
| ---------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `userId`   | query | 否   | 玩家 ID 精确匹配。                                                                                                |
| `entry`    | query | 否   | 入口。                                                                                                            |
| `mode`     | query | 否   | 模式精确匹配；未知值只会得到空结果。                                                                              |
| `status`   | query | 否   | 记录状态精确匹配；未知值只会得到空结果。                                                                          |
| `page`     | query | 否   | 页码；无效或小于 1 归 1，最大 100000。 最大 100000；默认 `1`                                                      |
| `pageSize` | query | 否   | 每页条数；玩家/管理员列表无效或小于 1 归 20、大于 100 截为 100；对局列表超范围归 20。 最小 1；最大 100；默认 `20` |

**请求体：** 无。

**成功：** HTTP 200，返回 [SessionPage](#schema-sessionpage)。

**错误：** 400 — INVALID_INPUT：入口非法或页码过大。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/sessions?page=1&pageSize=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "items": [
    {
      "id": "cccccccccccccccccccccccccccccccc",
      "userId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "nickname": "萌宠玩家",
      "entry": "campaign",
      "mode": "classic",
      "ordinal": 100,
      "title": "接口示例关卡",
      "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "status": "playing",
      "settled": false,
      "moves": 0,
      "cleared": 0,
      "total": 3,
      "steps": 0,
      "rewardCoins": 0,
      "startedAt": "2026-10-25T08:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

#### 53. 查看完整对局回放

`GET /api/v1/admin/sessions/{id}/replay`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体。返回固定配置、初始棋盘、公开对局状态、所有动作及每步之后的公开状态、玩家和链路信息、最终记录状态。可审计任何玩家；无 X-User-ID 要求。

| 参数 | 位置 | 必填 | 说明                                    |
| ---- | ---- | ---- | --------------------------------------- |
| `id` | path | 是   | 目标资源 ID；从对应列表或创建响应取得。 |

**请求体：** 无。

**成功：** HTTP 200，返回 [Replay](#schema-replay)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 404 — NOT_FOUND：对局不存在。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/sessions/$SESSION_ID/replay" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{
  "session": {
    "entry": "campaign",
    "id": "cccccccccccccccccccccccccccccccc",
    "levelId": "dddddddddddddddddddddddddddddddd",
    "revisionId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "ordinal": 100,
    "title": "接口示例关卡",
    "seed": 1,
    "state": {
      "tiles": [
        { "id": 0, "kind": 0, "x": -96, "y": 0, "layer": 0, "removed": false },
        { "id": 1, "kind": 0, "x": 0, "y": 0, "layer": 0, "removed": false },
        { "id": 2, "kind": 0, "x": 96, "y": 0, "layer": 0, "removed": false }
      ],
      "tray": [],
      "reserve": [],
      "matches": 0,
      "cleared": 0,
      "moves": 0,
      "status": "playing",
      "mode": "classic",
      "capacity": 7,
      "tools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
      "rulesVersion": "pet-rules-2",
      "rules": [[3]]
    },
    "lastSeq": 0,
    "settled": false,
    "rewardCoins": 0
  },
  "userId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "campaignId": "cccccccccccccccccccccccccccccccc",
  "initial": {
    "tiles": [
      { "id": 0, "kind": 0, "x": -96, "y": 0, "layer": 0, "removed": false },
      { "id": 1, "kind": 0, "x": 0, "y": 0, "layer": 0, "removed": false },
      { "id": 2, "kind": 0, "x": 96, "y": 0, "layer": 0, "removed": false }
    ],
    "tray": [],
    "reserve": [],
    "matches": 0,
    "cleared": 0,
    "moves": 0,
    "status": "playing",
    "mode": "classic",
    "capacity": 7,
    "tools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rulesVersion": "pet-rules-2",
    "rules": [[3]]
  },
  "config": {
    "rulesVersion": "pet-rules-2",
    "rules": [[3]],
    "mode": "classic",
    "columns": 3,
    "rows": 1,
    "layers": [
      {
        "z": 0,
        "cells": [
          { "x": 0, "y": 0 },
          { "x": 2, "y": 0 },
          { "x": 4, "y": 0 }
        ]
      }
    ],
    "counts": [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "capacity": 7,
    "freeTools": { "undo": 1, "shovel": 1, "hint": 3, "shuffle": 1 },
    "rewardCoins": 10
  },
  "events": [],
  "status": "playing",
  "startedAt": "2026-10-25T08:00:00Z"
}
```

### 应用设置

#### 54. 读取公告管理设置

`GET /api/v1/admin/settings`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

无请求体；返回公告和并发版本 version。

**路径/查询参数：** 无。

**请求体：** 无。

**成功：** HTTP 200，返回 [Settings](#schema-settings)。

**错误：** 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X GET "$BASE/api/v1/admin/settings" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

成功响应形状示例：

```json
{ "announcement": "欢迎来到快乐萌宠消！", "version": 1, "updatedAt": "2026-10-25T08:00:00Z" }
```

#### 55. 更新公告

`PUT /api/v1/admin/settings`

**认证：** 管理员 Cookie 会话或 Authorization: Bearer <管理员访问 Token>。Cookie 写请求检查同源；Bearer 写请求不依赖 Cookie 来源校验。显式 Authorization 无效时绝不回退 Cookie。

announcement 和 version 都必须提供；空串清空公告。最多 2000 Unicode 字符；CRLF/CR 转换为 LF；只允许换行和 Tab 控制字符。保存成功 version 递增，公开公告立即读取新内容。

**路径/查询参数：** 无。

**请求体：** [SettingsInput](#schema-settingsinput)，完整字段见下方同名数据结构。

**成功：** HTTP 200，返回 [Settings](#schema-settings)。

**错误：** 400 — INVALID_INPUT：缺少字段、版本或正文不合法。 401 — UNAUTHORIZED：凭证缺失、无效、过期、已撤销或账号不可用。 403 — ORIGIN_REJECTED：Cookie 写请求来源不被允许。 409 — CONFLICT：公告已被其他管理员更新，请重新读取并合并。 500 — INTERNAL_ERROR：服务异常；查看服务端日志，勿依据文案自动重试写操作。

```bash
curl -sS -X PUT "$BASE/api/v1/admin/settings" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"announcement":"欢迎来到快乐萌宠消！","version":1}'
```

成功响应形状示例：

```json
{ "announcement": "欢迎来到快乐萌宠消！", "version": 2, "updatedAt": "2026-10-25T08:00:00Z" }
```

## 全部数据结构

本节所有模型均可在上面的接口中直接定位。请求模型“必填”描述应发送的字段；响应模型“必填”表示固定出现字段。“可选”时间若模型注明 null 则返回 null；未注明 nullable 的输入不要发送 null。密码长度以 UTF-8 **字节**为准；schema 的字符上下界只是粗略辅助，服务端字节校验最终生效。所有嵌套模型都在本文件中。

<a id="schema-error"></a>

### Error

| 字段    | 类型                                 | 必填 | 说明 |
| ------- | ------------------------------------ | ---- | ---- |
| `error` | object {code:string, message:string} | 是   |      |

<a id="schema-health"></a>

### Health

| 字段     | 类型                              | 必填 | 说明             |
| -------- | --------------------------------- | ---- | ---------------- |
| `status` | string = `"ok"` / `"unavailable"` | 是   | 数据库探测结果。 |

<a id="schema-info"></a>

### Info

| 字段      | 类型   | 必填 | 说明           |
| --------- | ------ | ---- | -------------- |
| `name`    | string | 是   | 产品名称。     |
| `version` | string | 是   | 应用信息版本。 |

<a id="schema-openapidocument"></a>

### OpenAPIDocument

完整 OpenAPI 3.0.3 文档，包含 info、servers、paths、components、tags。

| 字段         | 类型                | 必填 | 说明 |
| ------------ | ------------------- | ---- | ---- |
| `openapi`    | string              | 是   |      |
| `info`       | object              | 是   |      |
| `servers`    | array&lt;object&gt; | 是   |      |
| `paths`      | object              | 是   |      |
| `components` | object              | 是   |      |

<a id="schema-adminaccount"></a>

### AdminAccount

独立管理员账号视图，不包含口令、Token 或哈希。

| 字段          | 类型                               | 必填 | 说明                                                                                     |
| ------------- | ---------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `id`          | string                             | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                          |
| `username`    | string                             | 是   | 去首尾空白并转小写；3–32 位字母、数字、下划线、点、横线。；格式 `^[a-zA-Z0-9_.-]{3,32}$` |
| `nickname`    | string                             | 是   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32         |
| `role`        | string = `"admin"`                 | 否   | 兼容字段，始终为 admin。                                                                 |
| `status`      | string = `"active"` / `"disabled"` | 是   | 正常或禁用；软删除由 deletedAt 表示。                                                    |
| `remark`      | string                             | 是   | 管理员备注，最多 500 个 Unicode 字符。；最长字符数 500                                   |
| `createdAt`   | string                             | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                                |
| `updatedAt`   | string                             | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                                |
| `lastLoginAt` | string / null                      | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                                |
| `deletedAt`   | string / null                      | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                                |

<a id="schema-player"></a>

### Player

玩家视图。remark 仅管理员读取时可出现；空备注也可能省略。微信标识和密码哈希不返回。

| 字段            | 类型                               | 必填 | 说明                                                                             |
| --------------- | ---------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `id`            | string                             | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                  |
| `username`      | string                             | 是   | 手工账号用户名；纯微信用户通常为空字符串。                                       |
| `nickname`      | string                             | 是   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32 |
| `avatarUrl`     | string                             | 是   | 头像公网地址；可能为空。                                                         |
| `avatarMediaId` | string                             | 是   | 历史头像媒体 ID；可能为空。                                                      |
| `role`          | string = `"user"`                  | 是   | 玩家角色，始终为 user。                                                          |
| `status`        | string = `"active"` / `"disabled"` | 是   | 正常或禁用；软删除由 deletedAt 表示。                                            |
| `source`        | string = `"wechat"` / `"manual"`   | 是   | 注册来源。                                                                       |
| `remark`        | string                             | 否   | 管理员备注，最多 500 个 Unicode 字符。；最长字符数 500                           |
| `createdAt`     | string                             | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                        |
| `updatedAt`     | string                             | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                        |
| `lastLoginAt`   | string / null                      | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                        |
| `deletedAt`     | string / null                      | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                        |

<a id="schema-wechatlogininput"></a>

### WechatLoginInput

| 字段   | 类型   | 必填 | 说明                                                                            |
| ------ | ------ | ---- | ------------------------------------------------------------------------------- |
| `code` | string | 是   | wx.login 取得的一次性 code；非空，最长 256 字节。；最短字符数 1；最长字符数 256 |

<a id="schema-playersession"></a>

### PlayerSession

| 字段          | 类型                     | 必填 | 说明                                      |
| ------------- | ------------------------ | ---- | ----------------------------------------- |
| `accessToken` | string                   | 是   | 玩家 Bearer JWT。                         |
| `expiresAt`   | string                   | 是   | RFC 3339 时间戳，含时区。；格式 date-time |
| `user`        | [Player](#schema-player) | 是   |                                           |

<a id="schema-adminlogininput"></a>

### AdminLoginInput

| 字段       | 类型   | 必填 | 说明                                                                         |
| ---------- | ------ | ---- | ---------------------------------------------------------------------------- |
| `username` | string | 是   | 管理员用户名，去空白后按小写匹配。；最长字符数 64                            |
| `password` | string | 是   | 10–72 UTF-8 字节（不是字符数）。；最短字符数 1；最长字符数 72；格式 password |

<a id="schema-createaccountinput"></a>

### CreateAccountInput

同形状的输入可创建管理员或玩家，权限由路由确定；不存在 role 输入字段。

| 字段       | 类型   | 必填 | 说明                                                                                     |
| ---------- | ------ | ---- | ---------------------------------------------------------------------------------------- |
| `username` | string | 是   | 去首尾空白并转小写；3–32 位字母、数字、下划线、点、横线。；格式 `^[a-zA-Z0-9_.-]{3,32}$` |
| `password` | string | 是   | 10–72 UTF-8 字节（不是字符数）。；最短字符数 1；最长字符数 72；格式 password             |
| `nickname` | string | 是   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32         |
| `remark`   | string | 否   | 管理员备注，最多 500 个 Unicode 字符。；最长字符数 500                                   |

<a id="schema-updateaccountinput"></a>

### UpdateAccountInput

PATCH 仍需提交完整 nickname 和 status。remark 省略等同空字符串，会清空备注。

| 字段       | 类型                               | 必填 | 说明                                                                             |
| ---------- | ---------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `nickname` | string                             | 是   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32 |
| `status`   | string = `"active"` / `"disabled"` | 是   | 正常或禁用；软删除由 deletedAt 表示。                                            |
| `remark`   | string                             | 否   | 管理员备注，最多 500 个 Unicode 字符。；最长字符数 500                           |

<a id="schema-passwordinput"></a>

### PasswordInput

| 字段       | 类型   | 必填 | 说明                                                                         |
| ---------- | ------ | ---- | ---------------------------------------------------------------------------- |
| `password` | string | 是   | 10–72 UTF-8 字节（不是字符数）。；最短字符数 1；最长字符数 72；格式 password |

<a id="schema-changepasswordinput"></a>

### ChangePasswordInput

| 字段              | 类型   | 必填 | 说明                                                                         |
| ----------------- | ------ | ---- | ---------------------------------------------------------------------------- |
| `currentPassword` | string | 是   | 本人当前密码。；格式 password                                                |
| `password`        | string | 是   | 10–72 UTF-8 字节（不是字符数）。；最短字符数 1；最长字符数 72；格式 password |

<a id="schema-accesstokeninput"></a>

### AccessTokenInput

| 字段          | 类型   | 必填 | 说明                                                                                                                         |
| ------------- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `accessToken` | string | 否   | 可省略或给空字符串以自动生成；自定义值为 32–128 个可打印 ASCII 字符且不含空白。；最长字符数 128；格式 `^(?:[!-~]{32,128})?$` |

<a id="schema-accesstokenmetadata"></a>

### AccessTokenMetadata

| 字段         | 类型          | 必填 | 说明                                      |
| ------------ | ------------- | ---- | ----------------------------------------- |
| `configured` | boolean       | 是   | 是否已配置有效访问 Token。                |
| `hint`       | string        | 是   | 掩码提示，不能用来鉴权。                  |
| `updatedAt`  | string / null | 是   | RFC 3339 时间戳，含时区。；格式 date-time |

<a id="schema-accesstokencreated"></a>

### AccessTokenCreated

| 字段          | 类型   | 必填 | 说明                                          |
| ------------- | ------ | ---- | --------------------------------------------- |
| `accessToken` | string | 是   | 完整 Token 仅此次响应返回；请在本地安全保存。 |
| `hint`        | string | 是   | 掩码提示。                                    |
| `updatedAt`   | string | 是   | RFC 3339 时间戳，含时区。；格式 date-time     |

<a id="schema-profileinput"></a>

### ProfileInput

| 字段        | 类型   | 必填 | 说明                                                                                                                                                                                  |
| ----------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nickname`  | string | 是   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32                                                                                                      |
| `avatarUrl` | string | 否   | 可省略以保留头像，空串清除。只接受 qlogo.cn、qpic.cn 或其子域的 HTTP(S) URL，规范化为 HTTPS；最长 2048 字节；不允许端口、用户信息、片段、空白、控制字符。null 非法。；最长字符数 2048 |

<a id="schema-playerstats"></a>

### PlayerStats

| 字段       | 类型    | 必填 | 说明                             |
| ---------- | ------- | ---- | -------------------------------- |
| `total`    | integer | 是   | 未删除玩家总数。                 |
| `wechat`   | integer | 是   | 未删除微信玩家数。               |
| `disabled` | integer | 是   | 未删除禁用玩家数。               |
| `today`    | integer | 是   | 上海时区今日创建的未删除玩家数。 |

<a id="schema-assets"></a>

### Assets

| 字段          | 类型                                                                 | 必填 | 说明                                                             |
| ------------- | -------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `coins`       | integer                                                              | 是   | 金币余额，0–1,000,000,000。；最小 0；最大 1000000000；格式 int64 |
| `bag`         | object {undo:integer, shovel:integer, hint:integer, shuffle:integer} | 是   |                                                                  |
| `signInCount` | integer                                                              | 是   | 累计签到次数，不是连续签到天数。；最小 0                         |
| `signedOn`    | string                                                               | 是   | 上次签到日期，Asia/Shanghai YYYY-MM-DD；未签到为空字符串。       |

<a id="schema-adjustmentinput"></a>

### AdjustmentInput

| 字段        | 类型                                                                | 必填 | 说明                                                                                                                 |
| ----------- | ------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `requestId` | string                                                              | 是   | 幂等键：16–80 位 ASCII 字母、数字、下划线或横线。每个逻辑操作生成新键，重试原样复用。；格式 `^[a-zA-Z0-9_-]{16,80}$` |
| `asset`     | string = `"coins"` / `"undo"` / `"shovel"` / `"hint"` / `"shuffle"` | 是   | 调整的资产类型。                                                                                                     |
| `delta`     | integer                                                             | 是   | 非零整数，范围 -1,000,000 到 1,000,000。；最小 -1000000；最大 1000000；格式 int64                                    |
| `reason`    | string                                                              | 是   | 原因去首尾空白后至少 2 字；原始值最多 200 个 Unicode 字符。；最短字符数 2；最长字符数 200                            |

<a id="schema-ledgerentry"></a>

### LedgerEntry

| 字段        | 类型                                                                | 必填 | 说明                                      |
| ----------- | ------------------------------------------------------------------- | ---- | ----------------------------------------- |
| `id`        | integer                                                             | 是   | 流水递增 ID。；格式 int64                 |
| `asset`     | string = `"coins"` / `"undo"` / `"shovel"` / `"hint"` / `"shuffle"` | 是   | 资产类型。                                |
| `delta`     | integer                                                             | 是   | 增减数量。；格式 int64                    |
| `balance`   | integer                                                             | 是   | 本次调整后的余额。；格式 int64            |
| `reason`    | string                                                              | 是   | 变更说明。                                |
| `actorId`   | string                                                              | 是   | 操作者管理员/玩家 ID，或 system。         |
| `createdAt` | string                                                              | 是   | RFC 3339 时间戳，含时区。；格式 date-time |

<a id="schema-cell"></a>

### Cell

| 字段 | 类型    | 必填 | 说明                                                |
| ---- | ------- | ---- | --------------------------------------------------- |
| `x`  | integer | 是   | 横坐标半格单位，0..2*(columns-1)。；最小 0；最大 10 |
| `y`  | integer | 是   | 纵坐标半格单位，0..2*(rows-1)。；最小 0；最大 14    |

<a id="schema-layer"></a>

### Layer

| 字段    | 类型                              | 必填 | 说明                                                                                |
| ------- | --------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `z`     | integer                           | 是   | 唯一层号 0–7。；最小 0；最大 7                                                      |
| `cells` | array&lt;[Cell](#schema-cell)&gt; | 是   | 该层至少一格；同层两格不能同时满足 \|dx\|<2 且 \|dy\|<2。；最少项数 1；最多项数 192 |

<a id="schema-layout"></a>

### Layout

| 字段      | 类型                                | 必填 | 说明                                                  |
| --------- | ----------------------------------- | ---- | ----------------------------------------------------- |
| `columns` | integer                             | 是   | 逻辑列数 1–6。；最小 1；最大 6                        |
| `rows`    | integer                             | 是   | 逻辑行数 1–8。；最小 1；最大 8                        |
| `layers`  | array&lt;[Layer](#schema-layer)&gt; | 是   | 1–8 层，所有层合计 3–192 格。；最少项数 1；最多项数 8 |

<a id="schema-rule"></a>

### Rule

单个消除组合。各组数量按降序规范化，总和 2–7；每组内部必须同种，不同组允许同种，每个方块只能计一次。如 [2,2] 接受两种各两只或同种四只，不接受三只加一只；[3,1] 接受三只加一只或同种四只。

类型：array&lt;integer&gt;。最少项数 1；最多项数 7。

<a id="schema-gameconfig"></a>

### GameConfig

| 字段           | 类型                                                                 | 必填 | 说明                                                                                                                |
| -------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `rulesVersion` | string = `"pet-rules-1"` / `"pet-rules-2"`                           | 是   | 当前写入推荐 pet-rules-2；历史快照可为 pet-rules-1。                                                                |
| `rules`        | array&lt;[Rule](#schema-rule)&gt;                                    | 否   | 历史运行快照可有 1–6 条，按顺序匹配。新写入只允许一条。pet-rules-1 快照省略时按旧语义恢复。；最少项数 1；最多项数 6 |
| `mode`         | string = `"classic"` / `"quartet"` / `"fun"`                         | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。                                 |
| `columns`      | integer                                                              | 是   | 列数。；最小 1；最大 6                                                                                              |
| `rows`         | integer                                                              | 是   | 行数。；最小 1；最大 8                                                                                              |
| `layers`       | array&lt;[Layer](#schema-layer)&gt;                                  | 是   | 有效几何布局。；最少项数 1；最多项数 8                                                                              |
| `counts`       | array&lt;integer&gt;                                                 | 是   | 15 项，下标即宠物 kind；总和必须等于总格数，3–192，且可按当前规则完全拆分。；最少项数 15；最多项数 15               |
| `capacity`     | integer = `7`                                                        | 是   | 配置中固定为 7；对局内可解锁到 8。                                                                                  |
| `freeTools`    | object {undo:integer, shovel:integer, hint:integer, shuffle:integer} | 是   |                                                                                                                     |
| `rewardCoins`  | integer                                                              | 是   | 本关首次通关金币奖励。；最小 0；最大 10000                                                                          |

<a id="schema-tile"></a>

### Tile

| 字段      | 类型    | 必填 | 说明                                    |
| --------- | ------- | ---- | --------------------------------------- |
| `id`      | integer | 是   | 数组索引，稳定方块 ID；可为 0。；最小 0 |
| `kind`    | integer | 是   | 宠物种类，0–14。；最小 0；最大 14       |
| `x`       | number  | 是   | 渲染横坐标，像素逻辑单位。              |
| `y`       | number  | 是   | 渲染纵坐标，像素逻辑单位。              |
| `layer`   | integer | 是   | 层级。                                  |
| `removed` | boolean | 是   | 已离开棋盘；仍可能位于 tray/reserve。   |

<a id="schema-frame"></a>

### Frame

| 字段      | 类型                                      | 必填 | 说明                |
| --------- | ----------------------------------------- | ---- | ------------------- |
| `tiles`   | array&lt;[Tile](#schema-tile)&gt;         | 是   | 完整方块数组。      |
| `tray`    | array&lt;integer&gt;                      | 是   | 收纳槽方块 ID。     |
| `reserve` | array&lt;integer&gt;                      | 是   | 铲子暂存区方块 ID。 |
| `matches` | integer                                   | 是   | 已触发消除次数。    |
| `cleared` | integer                                   | 是   | 累计已消除方块数。  |
| `moves`   | integer                                   | 是   | pick 步数。         |
| `status`  | string = `"playing"` / `"won"` / `"lost"` | 是   | 棋盘状态。          |

<a id="schema-action"></a>

### Action

| 字段     | 类型                                                                                 | 必填 | 说明                                                                                               |
| -------- | ------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------- |
| `seq`    | integer                                                                              | 是   | 从 1 开始连续递增，最大 10000。；最小 1；最大 10000                                                |
| `type`   | string = `"pick"` / `"undo"` / `"shovel"` / `"hint"` / `"shuffle"` / `"unlock_slot"` | 是   | pick 选牌；四种道具；unlock_slot 增加一格。                                                        |
| `tileId` | integer                                                                              | 否   | 仅 pick 使用的方块 ID；ID 0 是合法值，其他动作省略。；最小 0                                       |
| `at`     | integer                                                                              | 是   | 对局开始后的相对毫秒；非递减，0..604800000。不是 Unix 时间戳。；最小 0；最大 604800000；格式 int64 |

<a id="schema-eventsinput"></a>

### EventsInput

| 字段     | 类型                                  | 必填 | 说明                                                                                    |
| -------- | ------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| `events` | array&lt;[Action](#schema-action)&gt; | 是   | 整个批次事务提交。任一步非法则批次的新操作与资产变更全部回滚。；最少项数 1；最多项数 64 |

<a id="schema-startinput"></a>

### StartInput

| 字段                | 类型                                         | 必填 | 说明                                                                                                                 |
| ------------------- | -------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `entry`             | string = `"standard"` / `"campaign"`         | 否   | standard=挑战，campaign=闯关。省略写入入口时默认为 campaign。；默认 `"campaign"`                                     |
| `mode`              | string = `"classic"` / `"quartet"` / `"fun"` | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。                                  |
| `previousSessionId` | string                                       | 否   | 续关用已结算胜局 ID；开始/重新挑战可省略。                                                                           |
| `requestId`         | string                                       | 是   | 幂等键：16–80 位 ASCII 字母、数字、下划线或横线。每个逻辑操作生成新键，重试原样复用。；格式 `^[a-zA-Z0-9_-]{16,80}$` |

<a id="schema-finishinput"></a>

### FinishInput

| 字段      | 类型                                        | 必填 | 说明                                                     |
| --------- | ------------------------------------------- | ---- | -------------------------------------------------------- |
| `outcome` | string = `"won"` / `"lost"` / `"abandoned"` | 是   | 只能匹配服务端回放结果；playing 对局可放弃为 abandoned。 |

<a id="schema-finishresult"></a>

### FinishResult

| 字段          | 类型                                        | 必填 | 说明                                     |
| ------------- | ------------------------------------------- | ---- | ---------------------------------------- |
| `status`      | string = `"won"` / `"lost"` / `"abandoned"` | 是   | 已结算结果。                             |
| `rewardCoins` | integer                                     | 是   | 此对局已结算的奖励；重复读取不再次发放。 |
| `hasNext`     | boolean                                     | 是   | 胜利后是否还有可玩关卡。                 |
| `assets`      | [Assets](#schema-assets)                    | 是   |                                          |

<a id="schema-template"></a>

### Template

| 字段        | 类型                     | 必填 | 说明                                            |
| ----------- | ------------------------ | ---- | ----------------------------------------------- |
| `id`        | string                   | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。 |
| `name`      | string                   | 是   | 模板名称。                                      |
| `layout`    | [Layout](#schema-layout) | 是   |                                                 |
| `version`   | integer                  | 是   | 当前乐观锁版本。；最小 1                        |
| `updatedAt` | string                   | 是   | RFC 3339 时间戳，含时区。；格式 date-time       |

<a id="schema-templateinput"></a>

### TemplateInput

| 字段      | 类型                     | 必填 | 说明                                                           |
| --------- | ------------------------ | ---- | -------------------------------------------------------------- |
| `name`    | string                   | 是   | 去首尾空白，1–180 Unicode 字符。；最短字符数 1；最长字符数 180 |
| `layout`  | [Layout](#schema-layout) | 是   |                                                                |
| `version` | integer                  | 否   | 更新时必需且至少 1；创建时忽略。；最小 1                       |

<a id="schema-settings"></a>

### Settings

| 字段           | 类型    | 必填 | 说明                                      |
| -------------- | ------- | ---- | ----------------------------------------- |
| `announcement` | string  | 是   | 公告正文。                                |
| `version`      | integer | 是   | 乐观锁版本。；最小 1                      |
| `updatedAt`    | string  | 是   | RFC 3339 时间戳，含时区。；格式 date-time |

<a id="schema-settingsinput"></a>

### SettingsInput

| 字段           | 类型    | 必填 | 说明                                                                                                          |
| -------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| `announcement` | string  | 是   | 最多 2000 个 Unicode 字符；空串清空。允许换行和 Tab，禁止其他控制字符；CRLF/CR 规范化为 LF。；最长字符数 2000 |
| `version`      | integer | 是   | 先 GET 获取当前版本；保存成功后版本递增。；最小 1                                                             |

<a id="schema-announcement"></a>

### Announcement

| 字段        | 类型   | 必填 | 说明                                      |
| ----------- | ------ | ---- | ----------------------------------------- |
| `content`   | string | 是   | 公开公告正文，可能为空。                  |
| `updatedAt` | string | 是   | RFC 3339 时间戳，含时区。；格式 date-time |

<a id="schema-ok"></a>

### OK

| 字段 | 类型             | 必填 | 说明 |
| ---- | ---------------- | ---- | ---- |
| `ok` | boolean = `true` | 是   |      |

<a id="schema-authoringconfig"></a>

### AuthoringConfig

预览/发布配置；新写入每关恰好一个消除组合。pet-rules-2 必须提供 rules。

| 字段           | 类型                                                                 | 必填 | 说明                                                                                                                |
| -------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `rulesVersion` | string = `"pet-rules-1"` / `"pet-rules-2"`                           | 是   | 当前写入推荐 pet-rules-2；历史快照可为 pet-rules-1。                                                                |
| `rules`        | array&lt;[Rule](#schema-rule)&gt;                                    | 否   | 历史运行快照可有 1–6 条，按顺序匹配。新写入只允许一条。pet-rules-1 快照省略时按旧语义恢复。；最少项数 1；最多项数 1 |
| `mode`         | string = `"classic"` / `"quartet"` / `"fun"`                         | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。                                 |
| `columns`      | integer                                                              | 是   | 列数。；最小 1；最大 6                                                                                              |
| `rows`         | integer                                                              | 是   | 行数。；最小 1；最大 8                                                                                              |
| `layers`       | array&lt;[Layer](#schema-layer)&gt;                                  | 是   | 有效几何布局。；最少项数 1；最多项数 8                                                                              |
| `counts`       | array&lt;integer&gt;                                                 | 是   | 15 项，下标即宠物 kind；总和必须等于总格数，3–192，且可按当前规则完全拆分。；最少项数 15；最多项数 15               |
| `capacity`     | integer = `7`                                                        | 是   | 配置中固定为 7；对局内可解锁到 8。                                                                                  |
| `freeTools`    | object {undo:integer, shovel:integer, hint:integer, shuffle:integer} | 是   |                                                                                                                     |
| `rewardCoins`  | integer                                                              | 是   | 本关首次通关金币奖励。；最小 0；最大 10000                                                                          |

<a id="schema-draftconfig"></a>

### DraftConfig

草稿允许暂存未配平的 counts 或未完成几何；最多 8 层、15 个 counts 项，序列化配置不超过 60000 字节。规则模式/版本/单组合仍立即校验。预览/发布才执行完整有效性验证。

| 字段           | 类型                                                                              | 必填 | 说明                                                                                                                |
| -------------- | --------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `rulesVersion` | string = `"pet-rules-1"` / `"pet-rules-2"`                                        | 是   | 当前写入推荐 pet-rules-2；历史快照可为 pet-rules-1。                                                                |
| `rules`        | array&lt;[Rule](#schema-rule)&gt;                                                 | 否   | 历史运行快照可有 1–6 条，按顺序匹配。新写入只允许一条。pet-rules-1 快照省略时按旧语义恢复。；最少项数 1；最多项数 1 |
| `mode`         | string = `"classic"` / `"quartet"` / `"fun"`                                      | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。                                 |
| `columns`      | integer                                                                           | 否   | 草稿暂存值；预览/发布约束见 GameConfig。                                                                            |
| `rows`         | integer                                                                           | 否   | 草稿暂存值；预览/发布约束见 GameConfig。                                                                            |
| `layers`       | array&lt;object {z:integer, cells:array&lt;object {x:integer, y:integer}&gt;}&gt; | 否   | 草稿暂存几何；预览/发布约束见 Layout。；最多项数 8                                                                  |
| `counts`       | array&lt;integer&gt;                                                              | 否   | 15 项，下标即宠物 kind；总和必须等于总格数，3–192，且可按当前规则完全拆分。；最多项数 15                            |
| `capacity`     | integer                                                                           | 否   | 草稿暂存值；预览/发布约束见 GameConfig。                                                                            |
| `freeTools`    | object                                                                            | 否   | 草稿道具计数；发布前必须配齐 undo/shovel/hint/shuffle，各 0–9。                                                     |
| `rewardCoins`  | integer                                                                           | 否   | 草稿暂存值；预览/发布约束见 GameConfig。                                                                            |

<a id="schema-draftinput"></a>

### DraftInput

| 字段           | 类型                                         | 必填 | 说明                                                                                |
| -------------- | -------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `entry`        | string = `"standard"` / `"campaign"`         | 否   | standard=挑战，campaign=闯关。省略写入入口时默认为 campaign。；默认 `"campaign"`    |
| `mode`         | string = `"classic"` / `"quartet"` / `"fun"` | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。 |
| `ordinal`      | integer                                      | 是   | 目录内正整数序号；entry+mode+ordinal 唯一，建后不可变。；最小 1                     |
| `title`        | string                                       | 是   | 非空标题，最多 180 UTF-8 字节。；最短字符数 1；最长字符数 180                       |
| `config`       | [DraftConfig](#schema-draftconfig)           | 是   |                                                                                     |
| `draftVersion` | integer                                      | 否   | PUT 更新时提交当前版本；创建可省略。；最小 1                                        |

<a id="schema-level"></a>

### Level

| 字段           | 类型                                                                   | 必填 | 说明                                                                                |
| -------------- | ---------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `id`           | string                                                                 | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                     |
| `entry`        | string = `"standard"` / `"campaign"`                                   | 是   | standard=挑战，campaign=闯关。省略写入入口时默认为 campaign。                       |
| `mode`         | string = `"classic"` / `"quartet"` / `"fun"`                           | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。 |
| `ordinal`      | integer                                                                | 是   | 关卡序号。                                                                          |
| `title`        | string                                                                 | 是   | 标题；玩家列表使用已发布版本标题。                                                  |
| `config`       | [GameConfig](#schema-gameconfig) 或 [DraftConfig](#schema-draftconfig) | 是   | 管理员列表是草稿；玩家列表是已发布的完整配置。                                      |
| `draftVersion` | integer                                                                | 是   | 草稿乐观锁版本。                                                                    |
| `revisionId`   | string                                                                 | 是   | 已发布不可变版本 ID；未发布为空。                                                   |
| `enabled`      | boolean                                                                | 是   | 是否启用。                                                                          |
| `updatedAt`    | string                                                                 | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                           |

<a id="schema-state"></a>

### State

| 字段           | 类型                                                                 | 必填 | 说明                                                                                                                |
| -------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `tiles`        | array&lt;[Tile](#schema-tile)&gt;                                    | 是   | 完整方块数组。                                                                                                      |
| `tray`         | array&lt;integer&gt;                                                 | 是   | 收纳槽方块 ID。                                                                                                     |
| `reserve`      | array&lt;integer&gt;                                                 | 是   | 铲子暂存区方块 ID。                                                                                                 |
| `matches`      | integer                                                              | 是   | 已触发消除次数。                                                                                                    |
| `cleared`      | integer                                                              | 是   | 累计已消除方块数。                                                                                                  |
| `moves`        | integer                                                              | 是   | pick 步数。                                                                                                         |
| `status`       | string = `"playing"` / `"won"` / `"lost"`                            | 是   | 棋盘状态。                                                                                                          |
| `mode`         | string = `"classic"` / `"quartet"` / `"fun"`                         | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。                                 |
| `capacity`     | integer = `7` / `8`                                                  | 是   | 当前容量 7 或解锁后的 8。                                                                                           |
| `tools`        | object {undo:integer, shovel:integer, hint:integer, shuffle:integer} | 是   |                                                                                                                     |
| `history`      | array&lt;[Frame](#schema-frame)&gt;                                  | 否   | 只在所有者 recovery 返回；其他响应省略。最多 64 帧。；最多项数 64                                                   |
| `rulesVersion` | string = `"pet-rules-1"` / `"pet-rules-2"`                           | 是   | 当前写入推荐 pet-rules-2；历史快照可为 pet-rules-1。                                                                |
| `rules`        | array&lt;[Rule](#schema-rule)&gt;                                    | 否   | 历史运行快照可有 1–6 条，按顺序匹配。新写入只允许一条。pet-rules-1 快照省略时按旧语义恢复。；最少项数 1；最多项数 6 |

<a id="schema-session"></a>

### Session

| 字段          | 类型                                 | 必填 | 说明                                                                              |
| ------------- | ------------------------------------ | ---- | --------------------------------------------------------------------------------- |
| `entry`       | string = `"standard"` / `"campaign"` | 是   | standard=挑战，campaign=闯关。省略写入入口时默认为 campaign。                     |
| `id`          | string                               | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                   |
| `levelId`     | string                               | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                   |
| `revisionId`  | string                               | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                   |
| `ordinal`     | integer                              | 是   | 本局关卡序号。                                                                    |
| `title`       | string                               | 是   | 开始时固定的发布标题。                                                            |
| `seed`        | integer                              | 是   | 服务端生成的 uint32 种子，以 JSON 整数传输。；最小 0；最大 4294967295；格式 int64 |
| `state`       | [State](#schema-state)               | 是   |                                                                                   |
| `lastSeq`     | integer                              | 是   | 最后成功提交的操作序号，初始 0。                                                  |
| `settled`     | boolean                              | 是   | 是否已结算。                                                                      |
| `rewardCoins` | integer                              | 是   | 本局结算奖励，未结算为 0。                                                        |

<a id="schema-eventresult"></a>

### EventResult

| 字段      | 类型                     | 必填 | 说明           |
| --------- | ------------------------ | ---- | -------------- |
| `state`   | [State](#schema-state)   | 是   |                |
| `lastSeq` | integer                  | 是   | 最终确认序号。 |
| `assets`  | [Assets](#schema-assets) | 是   |                |

<a id="schema-sessionrecord"></a>

### SessionRecord

| 字段          | 类型                                                      | 必填 | 说明                                                                                |
| ------------- | --------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `id`          | string                                                    | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                     |
| `userId`      | string                                                    | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                     |
| `nickname`    | string                                                    | 是   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32    |
| `entry`       | string = `"standard"` / `"campaign"`                      | 是   | standard=挑战，campaign=闯关。省略写入入口时默认为 campaign。                       |
| `mode`        | string = `"classic"` / `"quartet"` / `"fun"`              | 是   | 规则目录：classic 经典三消、quartet 四消、fun 趣味双对；实际匹配依据 config.rules。 |
| `ordinal`     | integer                                                   | 是   | 关卡序号。                                                                          |
| `title`       | string                                                    | 是   | 本局固定标题。                                                                      |
| `revisionId`  | string                                                    | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。                                     |
| `status`      | string = `"playing"` / `"won"` / `"lost"` / `"abandoned"` | 是   | 记录状态。                                                                          |
| `settled`     | boolean                                                   | 是   | 是否已结算。                                                                        |
| `moves`       | integer                                                   | 是   | pick 次数。                                                                         |
| `cleared`     | integer                                                   | 是   | 消除方块数。                                                                        |
| `total`       | integer                                                   | 是   | 初始方块总数。                                                                      |
| `steps`       | integer                                                   | 是   | 已提交最后序号。                                                                    |
| `rewardCoins` | integer                                                   | 是   | 本局奖励。                                                                          |
| `startedAt`   | string                                                    | 是   | RFC 3339 时间戳，含时区。；格式 date-time                                           |

<a id="schema-replay"></a>

### Replay

| 字段         | 类型                                                                                                                | 必填 | 说明                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------- |
| `session`    | [Session](#schema-session)                                                                                          | 是   |                                                 |
| `userId`     | string                                                                                                              | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。 |
| `campaignId` | string                                                                                                              | 是   | 服务端返回的不透明 ID；请从列表或创建响应取得。 |
| `initial`    | [State](#schema-state)                                                                                              | 是   |                                                 |
| `config`     | [GameConfig](#schema-gameconfig)                                                                                    | 是   |                                                 |
| `events`     | array&lt;object {seq:integer, action:[Action](#schema-action), state:[State](#schema-state), receivedAt:string}&gt; | 是   | 按 seq 升序的原始动作与动作后状态。             |
| `status`     | string = `"playing"` / `"won"` / `"lost"` / `"abandoned"`                                                           | 是   | 服务端记录状态，放弃时为 abandoned。            |
| `startedAt`  | string                                                                                                              | 是   | RFC 3339 时间戳，含时区。；格式 date-time       |

<a id="schema-adminpage"></a>

### AdminPage

| 字段       | 类型                                              | 必填 | 说明                             |
| ---------- | ------------------------------------------------- | ---- | -------------------------------- |
| `items`    | array&lt;[AdminAccount](#schema-adminaccount)&gt; | 是   | 当前页记录，空列表为 []。        |
| `total`    | integer                                           | 是   | 符合筛选条件的总数。；格式 int64 |
| `page`     | integer                                           | 是   | 实际页码。                       |
| `pageSize` | integer                                           | 是   | 实际每页条数。                   |

<a id="schema-playerpage"></a>

### PlayerPage

| 字段       | 类型                                  | 必填 | 说明                             |
| ---------- | ------------------------------------- | ---- | -------------------------------- |
| `items`    | array&lt;[Player](#schema-player)&gt; | 是   | 当前页记录，空列表为 []。        |
| `total`    | integer                               | 是   | 符合筛选条件的总数。；格式 int64 |
| `page`     | integer                               | 是   | 实际页码。                       |
| `pageSize` | integer                               | 是   | 实际每页条数。                   |

<a id="schema-sessionpage"></a>

### SessionPage

| 字段       | 类型                                                | 必填 | 说明                             |
| ---------- | --------------------------------------------------- | ---- | -------------------------------- |
| `items`    | array&lt;[SessionRecord](#schema-sessionrecord)&gt; | 是   | 当前页记录，空列表为 []。        |
| `total`    | integer                                             | 是   | 符合筛选条件的总数。；格式 int64 |
| `page`     | integer                                             | 是   | 实际页码。                       |
| `pageSize` | integer                                             | 是   | 实际每页条数。                   |

<a id="schema-adminupdateinput"></a>

### AdminUpdateInput

nickname、status、remark 部分更新；缺省字段保留，至少提供一个非 null 字段。remark:"" 清空。

| 字段       | 类型                               | 必填 | 说明                                                                             |
| ---------- | ---------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `nickname` | string                             | 否   | 去首尾空白后 1–32 个 Unicode 字符，不允许控制字符。；最短字符数 1；最长字符数 32 |
| `status`   | string = `"active"` / `"disabled"` | 否   | 正常或禁用；软删除由 deletedAt 表示。                                            |
| `remark`   | string                             | 否   | 管理员备注，最多 500 个 Unicode 字符。；最长字符数 500                           |

## 单个关卡数据分析

### GET /api/v1/admin/levels/{id}/analytics

`GET /api/v1/admin/levels/{id}/analytics`

使用管理员 Cookie 或 `Authorization: Bearer <ACCESS_TOKEN>`，不需要 `X-User-ID`。玩家 JWT 不能访问。本接口只读，不创建对局、结算或修改历史记录。

| 参数       | 位置  | 说明                                                         |
| ---------- | ----- | ------------------------------------------------------------ |
| id         | path  | 关卡 ID；草稿、下架关卡也可查询。                            |
| range      | query | `7d`、`30d`（缺省/空值）、`90d`、`all`。                     |
| revisionId | query | 可省略/为空，表示全部发布版本；非空须是此关卡的发布版本 ID。 |

```sh
curl --get "$BASE/api/v1/admin/levels/$LEVEL_ID/analytics" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode 'range=7d'
```

需要比较历史版本时，加上 `--data-urlencode "revisionId=$REVISION_ID"`。返回中的 `revisions` 提供可选版本，按版本号倒序；`current` 标记当前发布版本，列表不受日期/版本筛选影响。

**时间与分母：** `7d/30d/90d` 以北京时间的自然日计，含今天与之前 N−1 天；从首日00:00开始，至请求时刻（不含）。筛选字段为对局开局时间，跨日结束仍计入开局日。`all` 的汇总为全部历史，趋势只显示最近90天。`daily` 按日期升序并补齐零值天。统计中只包含上传至服务器的真实对局，离线练习不计入。

- `summary.attempts` 为开局对局数；同一玩家重复开局分别计数，`players` 是去重玩家数。
- `won/lost/abandoned/unfinished` 分别对应通关、失败、主动退出、未结束，合计等于 attempts。未结束可能包含断线或未上报结果，绝不视为失败。
- `winRate = won / attempts × 100`；`finishedWinRate = won / (won + lost + abandoned) × 100`。分母为0时返回 null，不是假设0%。
- `avgWinDurationSeconds` 只取通关且 `ended_at >= started_at` 的有效服务端开始/结束时差，包含切后台/闲置时间；`winDurationSamples` 为有效样本数，无样本均值为null。
- `avgWinMoves` 为通关对局最终 `state.moves` 的平均值，仅点选计数、撤回会回退；不等于包含道具的全部事件数。
- `tools` 恒含 `undo/shovel/hint/shuffle/unlock_slot` 五类，`uses` 是接受的事件次数，`sessions` 是使用过的对局数。包括免费/背包道具；重复上报同一序号不会重复统计。`unlock_slot` 仅代表解锁行为，不能推断广告实际播放完成。
- `from/to/generatedAt` 为RFC3339，`from=null` 表示全部历史；`to` 是不包含的上界。`trendFrom` 为趋势首日，`timezone` 固定 `Asia/Shanghai`。多个统计查询在同一个只读可重复读快照内完成。

成功返回示例：

```json
{
  "level": {
    "id": "example-level-id",
    "title": "森林小径",
    "entry": "standard",
    "mode": "classic",
    "ordinal": 1,
    "publishedRevisionId": "example-revision-2"
  },
  "range": "7d",
  "revisionId": "",
  "from": "2026-10-19T00:00:00+08:00",
  "to": "2026-10-25T10:00:00+08:00",
  "trendFrom": "2026-10-19",
  "timezone": "Asia/Shanghai",
  "generatedAt": "2026-10-25T10:00:00+08:00",
  "summary": {
    "attempts": 5,
    "players": 2,
    "won": 2,
    "lost": 1,
    "abandoned": 1,
    "unfinished": 1,
    "winRate": 40,
    "finishedWinRate": 50,
    "avgWinDurationSeconds": 90,
    "winDurationSamples": 2,
    "avgWinMoves": 12
  },
  "daily": [
    {
      "date": "2026-10-19",
      "attempts": 0,
      "won": 0,
      "lost": 0,
      "abandoned": 0,
      "unfinished": 0,
      "winRate": null
    },
    {
      "date": "2026-10-20",
      "attempts": 0,
      "won": 0,
      "lost": 0,
      "abandoned": 0,
      "unfinished": 0,
      "winRate": null
    },
    {
      "date": "2026-10-21",
      "attempts": 0,
      "won": 0,
      "lost": 0,
      "abandoned": 0,
      "unfinished": 0,
      "winRate": null
    },
    {
      "date": "2026-10-22",
      "attempts": 0,
      "won": 0,
      "lost": 0,
      "abandoned": 0,
      "unfinished": 0,
      "winRate": null
    },
    {
      "date": "2026-10-23",
      "attempts": 0,
      "won": 0,
      "lost": 0,
      "abandoned": 0,
      "unfinished": 0,
      "winRate": null
    },
    {
      "date": "2026-10-24",
      "attempts": 2,
      "won": 1,
      "lost": 1,
      "abandoned": 0,
      "unfinished": 0,
      "winRate": 50
    },
    {
      "date": "2026-10-25",
      "attempts": 3,
      "won": 1,
      "lost": 0,
      "abandoned": 1,
      "unfinished": 1,
      "winRate": 33.333333333333336
    }
  ],
  "revisions": [
    {
      "id": "example-revision-2",
      "version": 2,
      "title": "森林小径",
      "publishedAt": "2026-10-18T10:00:00+08:00",
      "current": true
    },
    {
      "id": "example-revision-1",
      "version": 1,
      "title": "森林小径",
      "publishedAt": "2026-10-01T10:00:00+08:00",
      "current": false
    }
  ],
  "tools": [
    {
      "type": "undo",
      "uses": 0,
      "sessions": 0
    },
    {
      "type": "shovel",
      "uses": 0,
      "sessions": 0
    },
    {
      "type": "hint",
      "uses": 3,
      "sessions": 2
    },
    {
      "type": "shuffle",
      "uses": 0,
      "sessions": 0
    },
    {
      "type": "unlock_slot",
      "uses": 0,
      "sessions": 0
    }
  ]
}
```

返回顶层字段：`level`（id/title/entry/mode/ordinal/publishedRevisionId）、`range`、`revisionId`、`from`、`to`、`trendFrom`、`timezone`、`generatedAt`、`summary`、`daily`、`revisions`、`tools`。`daily` 每项字段为 date/attempts/won/lost/abandoned/unfinished/winRate；版本项为 id/version/title/publishedAt/current；道具项为 type/uses/sessions。未发布草稿 publishedRevisionId 为空，revisions 为 []。没有样本时计数为0，比率和平均值为null，工具和每日列表仍保持完整。

错误：400 `INVALID_INPUT`（非法range、未知或其他关卡版本）；401 `UNAUTHORIZED`（无有效管理员凭证或玩家JWT）；404 `NOT_FOUND`（关卡不存在）；500 `INTERNAL_ERROR`（统计查询失败）。后台入口：关卡管理每行的“数据分析”。机器可读字段和约束见 OpenAPI `LevelAnalytics`、`LevelAnalyticsSummary`、`LevelAnalyticsDay`、`LevelAnalyticsRevision`、`LevelAnalyticsTool`。

## 维护与验证

本文路径使用 OpenAPI 的 `{id}` 写法；Gin 路由源码使用 `:id`。新增或修改路由时，同时更新内嵌 OpenAPI 与本文的请求字段、成功响应、鉴权、错误码和示例。不要编辑已应用迁移来修复文档。

仓库中的 `TestOpenAPICoversLiveRoutesAndSkill` 通过真实路由表对比 method+path、检查 operationId 唯一性、本地 schema 引用以及本文路由索引；它无需数据库，且实际请求公开 OpenAPI 路由。运行：

```bash
cd backend
go test ./internal/httpapi -run '^TestOpenAPICoversLiveRoutesAndSkill$' -count=1
```

`/admin/SKILL.md` 是根目录本文件的静态副本，统一网关以 `text/markdown; charset=utf-8` 返回，不应被 SPA 首页替代。管理端开发服务读取根文件，构建时复制为静态资源。文档不含环境密钥、真实密码或访问 Token；Swagger 不依赖 CDN，也不将本机文档发到远程验证器。
