# 云端部署

生产服务由云端平台负责部署、更新、备份和停止。仓库保留云端镜像构建与服务编排配置，本地 Makefile 用于开发、检查和镜像构建。

## 文件与服务

| 文件                               | 用途                                   |
| ---------------------------------- | -------------------------------------- |
| `Dockerfile`                       | Go API，内嵌数据库迁移                 |
| `Dockerfile.admin`                 | React 管理后台静态镜像                 |
| `Dockerfile.gateway`、`nginx.conf` | 应用网关、路由和代理规则               |
| `compose.prod.yaml`                | 云端四服务编排、健康检查、网络与持久卷 |
| `.env.prod.example`                | 云端需要填写的环境变量清单             |
| `.github/workflows/ci.yml`         | 代码、接口与隔离容器验证               |

`deploy/` 中原来的宿主机 Nginx/宝塔示例已移除。容器网关使用根目录 `nginx.conf`；对外域名、HTTPS 证书和入口转发在云端平台配置。

## 镜像仓库

命名空间为 `failure-plan`，三个镜像坐标为：

```text
crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/failure-plan/happy-pet-backend:latest
crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/failure-plan/happy-pet-admin:latest
crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/failure-plan/happy-pet-gateway:latest
```

在 ACR 中绑定本项目的 `main` 分支，构建目录为 `/`，分别使用 `Dockerfile`、`Dockerfile.admin`、`Dockerfile.gateway`。三个镜像使用同一发布标签。`IMAGE_PREFIX` 是仓库域名和命名空间，`IMAGE_TAG` 是发布标签。

需要自行构建镜像时，仍可使用 `make images`、`make registry-login` 和 `make images-push`；这些命令不启动生产服务。

## 云端环境变量

参考 `.env.prod.example` 在云端平台设置以下变量：

| 变量                                 | 用途                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `IMAGE_PREFIX`、`IMAGE_TAG`          | 镜像命名空间和统一发布标签                           |
| `POSTGRES_PASSWORD`                  | 生产数据库密码                                       |
| `JWT_SECRET`                         | 至少 32 字节的独立随机签名密钥                       |
| `ADMIN_USERNAME`、`ADMIN_PASSWORD`   | 空库首次初始化管理员；现有账号密码不会被重置         |
| `ADMIN_ORIGIN`                       | 管理后台公开 HTTPS 来源，不带 `/admin/` 或 `/api/v1` |
| `WECHAT_APP_ID`、`WECHAT_APP_SECRET` | 微信小游戏身份校验配置，仅交给后端                   |
| `PGUSER`、`PGDATABASE`               | 默认 `happy_pet`，已有数据库继续沿用原值             |
| `GATEWAY_PORT`                       | 默认 `8080`                                          |

生产凭据由云端安全配置保存。不要把开发环境文件、AppSecret 或数据库备份提交到仓库或放进静态镜像。

## 网络与持久数据

服务为 `db`、`backend`、`admin`、`gateway`。数据库内部端口为 `5432`，API 内部端口为 `8080`。只有网关发布 `127.0.0.1:8080`，对外 HTTPS 入口转发到这个网关。后台路径为 `/admin/`，API 前缀为 `/api/v1`。

默认 Compose 项目名仍为 `happy-pet-production`，卷键为 `postgres`，数据库卷为 `happy-pet-production_postgres`。云端升级时保留现有项目标识、持久卷和数据库凭据。开发数据库 `happy-pet_happy_pet_postgres` 与生产分离。

默认容器网段为 `172.30.82.0/24`。网关只信任宿主机地址 `172.30.82.1` 的转发头，API 只信任网关 `172.30.82.2`；如果云端入口网络不同，按实际拓扑配置这些受信地址并重新构建网关。

后端启动时自动执行事务性迁移。首次部署使用 `000_schema_migrations.sql` 和 `001_initial.sql`，一次创建完整结构，再初始化管理员与关卡。系统初始化记录统一写入 `system_initializations(init_key, recorded_at)`；重复启动不会覆盖账号、金币、道具、关卡或回放。此首次部署基线已合并旧的 001–005；已有旧谱系数据库需要先备份、核对并显式转换，正常启动不会自动改写旧迁移账本。`002_user_avatar_url.sql` 增量增加微信头像 URL，首次部署和已有新基线部署都会自动执行；以后从 `003` 开始新增迁移，已发布的新基线不可修改。

## 发布与运维

1. 云端完成三个应用镜像的构建并设置一致的版本标签。
2. 在云端配置环境变量、持久卷、网络和 HTTPS 入口。
3. 等待数据库、API、后台健康，再开放网关入口。
4. 更新前通过云端备份方案保存数据库；更新后核对健康状态、登录、资产与回放。

升级、重启、日志查看和备份恢复均通过云端平台或云端流水线完成。仓库不再提供本地生产运维或手动部署打包命令。

小游戏构建机仍使用以下命令配置正式接口并导出微信包：

```sh
make configure-game API_PREVIEW_URL=https://hp.autora.cn/api/v1 API_PRODUCTION_URL=https://hp.autora.cn/api/v1
make build-wechat
```

微信后台配置对应 request 合法域名，微信开发者工具导入 `minigame/build/wechatgame` 完成真机预览和发布。

小游戏按运行环境选择接口：只有浏览器和开发者工具模拟器使用 `local`；真机 `develop` 开发版／扫码预览及 `trial` 体验版使用 `preview`；`release` 使用 `production`。微信版本未知时选择正式配置。预览和正式配置当前均为 `https://hp.autora.cn/api/v1`，开发版、扫码预览、体验版、审核及正式版都连接线上服务。模拟器判断优先于版本判断，在模拟器切换版本仍使用本地地址。三个地址分别配置，普通切换版本不必修改代码。

## CI 验证

GitHub CI 在 PR、推送 `main`/`master` 和手动触发时执行。它运行格式、类型、SQL、接口竞态检查，并直接调用 `scripts/test-deployment.mjs` 验证容器，不依赖本地生产运维命令。

容器验证使用随机项目名、临时凭据、独立数据库卷和临时镜像，检查首次建库、初始化回滚、认证与代理、已有基线重复启动、数据库归档恢复及对局回放保留。测试结束只清理自己创建的资源，不读取本地生产凭据，也不部署云端服务。报告写入 `artifacts/deployment-qa.json`。
