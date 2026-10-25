# Docker 生产部署

部署结构沿用 `D:\program\failure-plan`：GitHub CI 检查，阿里云 ACR 构建或本地构建推送，服务器拉取三个应用镜像，运行 PostgreSQL、API、后台静态站点和 Nginx 网关。小游戏包由 Cocos Creator 构建并通过微信开发者工具发布。

## 文件与服务

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | Go API、内嵌 SQL 迁移；非 root 运行 |
| `Dockerfile.admin` | pnpm 锁定依赖构建 React 后台，Nginx 服务 `/admin/` |
| `Dockerfile.gateway`、`nginx.conf` | 同域 API/后台入口、代理头校验和健康检查 |
| `compose.prod.yaml` | 生产镜像、独立网络、数据卷、健康依赖、日志轮转 |
| `.env.prod.example` | 不含凭据的生产配置模板 |
| `deploy/nginx-site.example.conf` | 宿主机或宝塔 HTTPS 站点示例 |
| `.github/workflows/ci.yml` | 后端、后台、真实 PostgreSQL、竞态及容器部署检查 |

生产服务为 `db`、`backend`、`admin`、`gateway`。只有网关发布 `127.0.0.1:8080`；数据库和 API 不发布宿主机端口。网关等待 API 和后台健康后才启动，API 在数据库连接初始化阶段执行迁移。没有独立初始化容器。

本地开发 API 也使用 8080，同一台机器切换到生产容器时先停止开发 API。后台开发服务使用 Vite 默认端口 5173。

保留原编排的项目名 `happy-pet-production` 和卷键 `postgres`，默认数据库卷仍为 **`happy-pet-production_postgres`**。从前一版本地镜像编排升级时不要改变项目名、卷名、数据库用户或密码。开发环境继续使用 `happy-pet_happy_pet_postgres`，端口为 5432，与生产分开。

Make 命令显式指定生产项目名，避免被其他项目遗留的 `COMPOSE_PROJECT_NAME` 环境变量影响。如果原部署使用了自定义项目名，所有命令统一加 `PROD_PROJECT=原项目名`；不要用新的项目名启动旧库。

## 镜像仓库

默认沿用参考项目的 ACR 地址，单独使用 `happy-pet` 命名空间：

```text
crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/happy-pet/backend:latest
crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/happy-pet/admin:latest
crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/happy-pet/gateway:latest
```

需要在 ACR 控制台创建该命名空间下的三个仓库，并绑定本项目的 Git 仓库。构建目录均为 `/`，Dockerfile 分别使用上述三个文件。可以沿用参考项目的 `main` 分支、`latest` 构建规则；本地仓库当前为 `master`，绑定时应选择实际推送的分支。需要可追溯发布时，三个镜像统一使用同一个版本标签。

镜像地址可通过 `.env.prod.local` 的 `IMAGE_PREFIX` 和 `IMAGE_TAG` 修改。构建机上的 Make 变量单独指定，需与生产配置保持一致：

```sh
make images IMAGE_TAG=2026.10.25-1
make registry-login
make images-push IMAGE_TAG=2026.10.25-1
```

`make images` 仅本地构建；`images-push` 才推送。仓库登录由 Docker 的交互提示完成，不把登录密码写入命令、Makefile 或镜像。本项目未代替用户创建云端仓库、绑定 Git 仓库或推送镜像。

启动和升级命令只使用本地已有镜像，不在过程中隐式重新拉取 `latest`。远程镜像更新统一通过 `prod-pull`，或包含拉取步骤的 `prod-update`；因此首次运行 `prod-up` 前应先完成构建或拉取。

## 准备生产配置

服务器只需 GNU Make、POSIX sh、常用 shell 工具和支持 `up --wait` 的 Docker Compose v2+，不需要 Node.js、pnpm、Go 或 Cocos Creator。生产部署统一使用 `compose.prod.yaml`，不包含本地构建步骤。

完整源码可以直接用于部署；也可以在开发机运行 `make deploy-bundle`，将 `artifacts/happy-pet-deploy.tar.gz` 传到服务器并解压。包内只有部署文件和本文，不含源码、`.env.prod.local` 或数据库备份。

在部署目录运行：

```sh
make prod-env
```

它只创建不存在的 `.env.prod.local`，保留已存在的文件；Linux 新文件权限为 600。其他路径可使用 `PROD_ENV=/path/to/config`。填写以下内容：

| 配置 | 要求 |
| --- | --- |
| `POSTGRES_PASSWORD` | 独立生产数据库密码；已有卷必须沿用原密码 |
| `JWT_SECRET` | 至少 32 字节的随机值；普通升级时保留 |
| `ADMIN_ORIGIN` | 对外 HTTPS 来源，例如 `https://game.example.com`，不要带路径或末尾 `/` |
| `ADMIN_USERNAME` | 首次初始化的管理账号，默认 `admin` |
| `ADMIN_PASSWORD` | 首次初始化密码，10–72 字节；已有账号不会被重置，可在初始化后留空 |
| `WECHAT_APP_ID` | 默认 `wx5f84ab7af535815d` |
| `WECHAT_APP_SECRET` | 对应小游戏密钥，仅传给 API；留空时后台可用，真实微信登录暂不可用 |
| `IMAGE_PREFIX`、`IMAGE_TAG` | 已构建的三个应用镜像的共同前缀与版本 |
| `PGUSER`、`PGDATABASE` | 默认均为 `happy_pet`；已有数据卷继续沿用 |
| `GATEWAY_PORT` | 默认 8080，只绑定宿主机回环地址 |

可在服务器用 `openssl rand -hex 32` 分别生成独立密码和签名密钥，然后填入配置文件。不要从开发配置或参考项目复制密钥。`.env.prod.local` 和备份目录均被 Git 忽略；Docker 构建采用文件允许列表并排除所有环境文件、密钥和备份。

```sh
make prod-config
make prod-images
```

前一条只校验编排，不打印秘密；后一条显示实际配置的镜像坐标。应用参数由 API 启动时校验。

## 首次部署

先确认三个镜像在仓库中可用，再执行：

```sh
make registry-login
make prod-pull
make prod-up
make prod-status
```

`prod-up` 会先校验编排，再启动并等待数据库、API、后台健康，最后单独启动网关。每个等待阶段默认最多 360 秒，可用 `DEPLOY_WAIT=600` 调整。空库在同一事务内创建结构和管理员，然后准备六个可配置闯关关卡和六个固定首页关卡；已有库通过迁移保留历史闯关记录，并补齐固定首页关卡，不清表、不重置密码。

后台地址为 `https://你的域名/admin/`，API 前缀为 `https://你的域名/api/v1`。内部健康检查为 `/api/health`，网关自身检查为 `/healthz`。后台深层路由可以直接访问或刷新；哈希静态资源长期缓存，页面和未带哈希的图片重新校验缓存，缺失静态资源返回 404。

如果使用自己在本机构建的镜像，把 `.env.prod.local` 中的 `IMAGE_PREFIX`/`IMAGE_TAG` 设为对应的本地坐标，运行 `make prod-up` 即可；本地镜像升级使用 `make prod-update-local`，不调用远程拉取。

## HTTPS 与微信域名

按 `deploy/nginx-site.example.conf` 配置宿主机 Nginx，替换域名和证书路径；宝塔已有 HTTPS 站点只需采用其中的 `location /` 反向代理配置。域名必须与 `ADMIN_ORIGIN` 一致，转发到 `127.0.0.1:8080`，修改 `GATEWAY_PORT` 时同步修改站点反代端口。

生产 Cookie 固定启用 Secure、HttpOnly、SameSite=Strict。外部 HTTPS 终止在宿主机站点，网关仅信任宿主机 `172.30.82.1` 的转发头，API 仅信任网关 `172.30.82.2/32`。外层代理必须覆盖 `X-Forwarded-For`，使用示例中的 `$remote_addr`，不要追加客户端提供的地址。

生产独立网络为 `172.30.82.0/24`，避开参考项目的 `172.30.81.0/24`。如果这个网段已被使用，应同时调整 Compose 的网络、固定地址、API 可信代理以及 `nginx.conf` 的宿主机地址，再重新构建网关。

小游戏构建机上执行：

```sh
make configure-game API_URL=https://你的域名/api/v1
make build-wechat
```

微信后台配置对应 request 合法域名，微信开发者工具导入 `minigame/build/wechatgame` 进行真机预览和发布。AppSecret 不进入小游戏或后台静态包。公网域名、证书和真实微信登录需要使用实际账号完成联调。

## 日常更新与故障恢复

更新前备份数据库，并保留生产配置和卷名。先更新服务器上的 Makefile、Compose 和配置模板文件，再设置本次镜像版本：

```sh
make prod-backup
make prod-update
make prod-status
```

`prod-update` 的顺序是：拉取镜像 → 停止网关和 API → 重建 API 容器并迁移 → 等待服务健康 → 恢复入口。重新创建 API 容器会重置上一次的健康状态，数据库卷保持不动。拉取失败时不停止已有服务。API 启动检查或迁移失败时不会监听，网关保持停止；修复配置或发布正确的镜像后，运行 `make prod-up`。使用本地已构建镜像时，`prod-update-local` 采用相同维护流程。

```sh
make prod-logs SERVICE=backend
make prod-logs SERVICE=gateway
make prod-stop
```

日志单文件最多 10 MB、每服务保留 3 个文件。`prod-stop` 只停止服务，保留容器和数据卷。没有清空生产数据库的 Make 命令。

已执行 SQL 的文件名、顺序和校验值不可修改；数据库结构变更必须新增连续版本。不要通过修改线上迁移记录绕过检查。只有数据库版本与旧镜像兼容时才可回退应用镜像；涉及数据库升级时优先修复并发布下一版本，或通过经验证的备份恢复到新的数据库。

## 数据库备份与恢复演练

```sh
make prod-backup
make prod-backup BACKUP_FILE=/secure/path/happy-pet-release.dump
make prod-backup-check BACKUP_FILE=/secure/path/happy-pet-release.dump
```

默认文件在 `backups/`，使用 UTC 时间和进程编号命名。备份为 PostgreSQL 自定义格式，保存用户、金币、背包、关卡版本、对局和操作记录。命令拒绝覆盖已有文件，失败文件保留 `.partial` 后缀。`prod-backup-check` 检查归档目录能否读取；完整恢复演练才能验证业务数据。备份包含用户数据，应另存到受限的独立存储中。

下面是在同一 PostgreSQL 实例中新建**空的演练数据库**，不会覆盖正在使用的业务库。将文件名换成实际备份路径，若演练库名已存在，选择新的名字：

```sh
docker compose --env-file .env.prod.local -f compose.prod.yaml exec -T db \
  sh -c 'createdb -U "$POSTGRES_USER" happy_pet_restore_check'

docker compose --env-file .env.prod.local -f compose.prod.yaml exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d happy_pet_restore_check --no-owner --no-privileges --exit-on-error --single-transaction' \
  < /secure/path/happy-pet-release.dump

docker compose --env-file .env.prod.local -f compose.prod.yaml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d happy_pet_restore_check -c "SELECT count(*) FROM users; SELECT count(*) FROM game_sessions; SELECT count(*) FROM game_events;"'
```

这些示例使用 POSIX shell，Windows 可使用 Git Bash；不要通过旧版 PowerShell 的文本管道传送二进制归档。正式恢复时先停止 API/网关，完整恢复到新库并核对资产与回放，再将 `PGDATABASE` 切换到该新库后启动。保留原库和原配置以便核对，使用与备份迁移版本匹配的应用镜像；应用不会自动降级数据库。

## 自动化验证

```sh
make verify-services
make ci-check
make test-deployment
make deploy-bundle
```

容器测试自己构建随机标签镜像，生成独立凭据和随机 Compose 项目，从不读取 `.env.prod.local`。它会运行真实 `prod-env`、`prod-up`、`prod-update-local`、备份和停止命令，检查：

- 四服务拓扑、私有 API/数据库、非 root 应用、健康检查、环境文件不进入镜像。
- 首次初始化、初始化失败回滚、重复启动不重置管理员密码。
- 后台路由与缓存、Cookie 来源保护、正常客户端 IP 透传及伪造代理头无法绕过限流。
- 002 版本数据库升级后，保留用户、金币、道具和历史关卡名称。
- 自定义格式备份及完整恢复到新的空数据库。
- 迁移失败时关闭入口，正常升级和停止重启后保留对局回放。

测试结束只清理自己的随机测试项目、卷和镜像标签。生产网段已被使用时，测试会拒绝启动，应在开发机或 CI Docker 环境执行。报告写入 `artifacts/deployment-qa.json`。

GitHub CI 在 PR、推送 `main`/`master` 和手动触发时执行，只需临时 PostgreSQL 凭据，不需要生产 Secrets；不会推送镜像或部署服务器。Cocos 图形编辑器和微信发布仍在本地工作流进行，CI 验证范围为后端、后台和生产 Docker 链路。
