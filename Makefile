SHELL := sh
.SHELLFLAGS := -eu -c
.DEFAULT_GOAL := help
export MSYS_NO_PATHCONV := 1
SQLC ?= sqlc
SQLC_VERSION := v1.31.1
GO_TEST_FLAGS ?=
BUILD_DIR ?= .build
PROD_ENV ?= .env.prod.local
PROD_PROJECT ?= happy-pet-production
DEPLOY_WAIT ?= 360
SERVICE ?=
BACKUP_DIR ?= backups
BACKUP_FILE ?=
IMAGE_REGISTRY ?= crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com
IMAGE_PREFIX ?= $(IMAGE_REGISTRY)/happy-pet
IMAGE_TAG ?= latest
PROD_COMPOSE := docker compose -p "$(PROD_PROJECT)" --env-file "$(PROD_ENV)" -f compose.prod.yaml
CREATOR ?= C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe
ifeq ($(OS),Windows_NT)
EXE := .exe
else
EXE :=
endif

.PHONY: help env-init setup install db-up db-down db-init migration-status dev dev-api dev-admin sqlc sqlc-check test test-api test-game typecheck build-admin build-api build-game build-wechat verify
.PHONY: configure-game test-browser test-startup preview-game test-ui format format-check lint tools go-version ci-check typecheck-admin build-services test-api-race verify-services images image-backend image-admin image-gateway images-push registry-login test-deployment prod-env prod-config prod-pull prod-up prod-update prod-status prod-logs prod-stop prod-backup prod-backup-check
.PHONY: prod-update-local prod-images deploy-bundle
## make setup          安装依赖并初始化独立开发数据库
## make dev            同时启动 API :8080、后台 :5173
## make dev-api        启动 API
## make dev-admin      启动管理后台
## make db-init        应用数据库迁移并准备初始关卡
## make migration-status 只读查看迁移状态
## make build-wechat   构建微信小游戏（minigame 目录）
## make build-game     构建网页游戏
## make verify         检查 SQL、类型、规则、接口和后台构建
## make configure-game API_URL=https://域名/api/v1  配置小游戏接口地址
## make images         构建三个生产镜像，可指定 IMAGE_PREFIX 和 IMAGE_TAG
## make images-push    推送指定版本的三个镜像
## make registry-login 登录镜像仓库，由 Docker 提示输入凭据
## make prod-env       创建独立生产配置副本，保留已存在的配置
## make prod-config    检查生产编排，不输出密钥
## make prod-pull      拉取生产配置指定的镜像版本
## make prod-up        启动生产服务，等待迁移和健康检查
## make prod-update    拉取镜像后暂停入口，再迁移和启动
## make prod-update-local  使用本地已构建镜像升级，流程相同但不拉取
## make prod-backup    备份生产数据库到 backups，保留已有文件
## make prod-backup-check BACKUP_FILE=文件.dump  检查备份目录结构
## make prod-status    查看生产服务状态
## make prod-images    查看生产配置实际使用的镜像版本
## make prod-logs SERVICE=backend  查看日志，可省略 SERVICE
## make prod-stop      停止生产服务，保留容器和数据库卷
## make test-deployment 构建隔离测试镜像并验证初始化、升级和备份恢复
## make deploy-bundle  打包服务器部署所需文件，不包含密钥或源码
help:
	@sed -n 's/^## //p' Makefile
env-init:
	node scripts/env-init.mjs
configure-game:
	API_URL="$(API_URL)" node scripts/configure-game.mjs
install:
	pnpm install --frozen-lockfile
	go -C backend mod download
tools:
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)
setup: env-init install db-init
db-up:
	docker compose up -d --wait db
db-down:
	docker compose stop db
db-init: env-init db-up
	go -C backend run ./cmd/api -migrate-only
migration-status:
	go -C backend run ./cmd/api -migration-status
dev:
	$(MAKE) -j2 dev-api dev-admin
dev-api: env-init
	go -C backend run ./cmd/api
dev-admin:
	pnpm --filter @happy-pet/admin dev
sqlc:
	$(SQLC) generate -f backend/sqlc.yaml
sqlc-check:
	$(SQLC) vet -f backend/sqlc.yaml
	$(SQLC) diff -f backend/sqlc.yaml
test-api:
	go -C backend test $(GO_TEST_FLAGS) -count=1 ./...
test-api-race:
	go -C backend test -race -count=1 -timeout=15m $(GO_TEST_FLAGS) ./...
test-game:
	node minigame/tools/test-game.cjs
	node minigame/tools/test-modes.cjs
	node minigame/tools/test-online.cjs
test: test-api test-game
test-browser:
	BROWSER_QA=1 go -C backend test ./internal/httpapi -run TestBrowserIntegration -v -count=1 -timeout=4m
typecheck:
	@$(MAKE) --no-print-directory typecheck-admin
	node scripts/check-game.cjs
typecheck-admin:
	pnpm --filter @happy-pet/admin typecheck
build-admin:
	pnpm --filter @happy-pet/admin build
build-api:
	mkdir -p "backend/$(BUILD_DIR)"
	go -C backend build -trimpath -o "$(BUILD_DIR)/happy-pet-api$(EXE)" ./cmd/api
build-services: build-admin build-api
build-game:
	powershell -NoProfile -File minigame/tools/build.ps1 -Platform web-mobile
build-wechat:
	powershell -NoProfile -File minigame/tools/build.ps1 -Platform wechatgame
verify: sqlc-check typecheck test build-admin build-api
verify-services: format-check lint sqlc-check typecheck-admin test-api build-services
test-startup:
	cd minigame && node tools/validate-wechat-build.cjs
	cd minigame && node tools/test-wechat-startup.cjs
preview-game:
	node minigame/tools/serve.cjs
test-ui:
	cd minigame && node tools/smoke-test.cjs
	cd minigame && node tools/test-rapid-input.cjs
	cd minigame && node tools/test-loading.cjs
format:
	pnpm exec oxfmt --write 'admin/src/**/*.{ts,tsx,css}' 'admin/*.ts' 'scripts/*.{mjs,cjs}'
	gofmt -w backend
format-check:
	pnpm exec oxfmt --check 'admin/src/**/*.{ts,tsx,css}' 'admin/*.ts' 'scripts/*.{mjs,cjs}'
	@files="$$(gofmt -l backend)"; if [ -n "$$files" ]; then printf '%s\n' "$$files"; exit 1; fi
lint:
	pnpm exec oxlint --deny-warnings admin/src admin/*.ts scripts
	go -C backend vet ./...
images: image-backend image-admin image-gateway
image-backend:
	docker build -f Dockerfile -t "$(IMAGE_PREFIX)/backend:$(IMAGE_TAG)" .
image-admin:
	docker build -f Dockerfile.admin -t "$(IMAGE_PREFIX)/admin:$(IMAGE_TAG)" .
image-gateway:
	docker build -f Dockerfile.gateway -t "$(IMAGE_PREFIX)/gateway:$(IMAGE_TAG)" .
images-push:
	docker push "$(IMAGE_PREFIX)/backend:$(IMAGE_TAG)"
	docker push "$(IMAGE_PREFIX)/admin:$(IMAGE_TAG)"
	docker push "$(IMAGE_PREFIX)/gateway:$(IMAGE_TAG)"
registry-login:
	docker login "$(IMAGE_REGISTRY)"
prod-env:
	@if [ -e "$(PROD_ENV)" ] || [ -L "$(PROD_ENV)" ]; then printf '%s\n' 'Keeping existing production configuration.'; else (umask 077; set -C; cat .env.prod.example > "$(PROD_ENV)"); printf '%s\n' 'Created production configuration. Fill in credentials and HTTPS origin before deployment.'; fi
prod-config:
	$(PROD_COMPOSE) config --quiet
prod-pull: prod-config
	$(PROD_COMPOSE) pull
prod-up: prod-config
	$(PROD_COMPOSE) up -d --no-build --pull never --wait --wait-timeout $(DEPLOY_WAIT) --remove-orphans db admin backend
	$(PROD_COMPOSE) up -d --no-build --pull never --wait --wait-timeout $(DEPLOY_WAIT) --remove-orphans gateway
prod-update:
	@$(MAKE) --no-print-directory prod-pull
	@$(MAKE) --no-print-directory prod-update-local
prod-update-local: prod-config
	$(PROD_COMPOSE) stop gateway backend
	$(PROD_COMPOSE) up -d --no-build --pull never --wait --wait-timeout $(DEPLOY_WAIT) db admin
	$(PROD_COMPOSE) up -d --no-build --pull never --no-deps --force-recreate backend
	@$(MAKE) --no-print-directory prod-up
prod-status:
	$(PROD_COMPOSE) ps
prod-images: prod-config
	$(PROD_COMPOSE) config --images
prod-logs:
	$(PROD_COMPOSE) logs -f --tail=100 $(SERVICE)
prod-stop:
	$(PROD_COMPOSE) stop
prod-backup: prod-config
	@umask 077; backup="$(BACKUP_FILE)"; \
	if [ -z "$$backup" ]; then backup="$(BACKUP_DIR)/happy-pet-$$(date -u +%Y%m%dT%H%M%SZ)-$$$$.dump"; fi; \
	mkdir -p "$$(dirname "$$backup")"; \
	if [ -e "$$backup" ] || [ -L "$$backup" ] || [ -e "$$backup.partial" ] || [ -L "$$backup.partial" ]; then printf '%s\n' 'Backup path exists; choose another file.' >&2; exit 1; fi; \
	(set -C; $(PROD_COMPOSE) exec -T db sh -c 'exec pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Fc --no-owner --no-privileges' > "$$backup.partial"); \
	$(PROD_COMPOSE) exec -T db pg_restore --list < "$$backup.partial" > /dev/null; \
	mv "$$backup.partial" "$$backup"; printf 'Backup saved: %s\n' "$$backup"
prod-backup-check: prod-config
	@test -n "$(BACKUP_FILE)" || { printf '%s\n' 'Set BACKUP_FILE to a PostgreSQL custom-format archive.' >&2; exit 1; }
	$(PROD_COMPOSE) exec -T db pg_restore --list < "$(BACKUP_FILE)" > /dev/null
	@printf '%s\n' 'Archive directory is readable. Test a restore before relying on a backup.'
go-version:
	@node -e 'const m = require("node:fs").readFileSync("backend/go.mod", "utf8").match(/^go (\d+\.\d+)(?:\.\d+)?$$/m); if (!m) throw new Error("Cannot read Go version"); console.log(m[1] + ".x");'
ci-check:
	go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 -no-color .github/workflows/ci.yml
test-deployment:
	node scripts/test-deployment.mjs
deploy-bundle:
	mkdir -p artifacts
	tar -czf artifacts/happy-pet-deploy.tar.gz Makefile compose.prod.yaml .env.prod.example docs/deployment.md deploy/nginx-site.example.conf
