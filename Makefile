SHELL := sh
.SHELLFLAGS := -eu -c
.DEFAULT_GOAL := help
export MSYS_NO_PATHCONV := 1
SQLC ?= sqlc
SQLC_VERSION := v1.31.1
GO_TEST_FLAGS ?=
BUILD_DIR ?= .build
IMAGE_REGISTRY ?= crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com
IMAGE_PREFIX ?= $(IMAGE_REGISTRY)/failure-plan
IMAGE_TAG ?= latest
CREATOR ?= C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe
ifeq ($(OS),Windows_NT)
EXE := .exe
else
EXE :=
endif

.PHONY: help env-init setup install db-up db-down db-init migration-status dev dev-api dev-admin sqlc sqlc-check test test-api test-game typecheck build-admin build-api build-game build-wechat verify
.PHONY: configure-game test-browser test-startup test-audio test-environments preview-game test-ui format format-check lint tools go-version ci-check typecheck-admin build-services test-api-race verify-services images image-backend image-admin image-gateway images-push registry-login
## make setup          安装依赖并初始化独立开发数据库
## make dev            同时启动 API :8080、后台 :5173
## make dev-api        启动 API
## make dev-admin      启动管理后台
## make db-init        应用数据库迁移并准备初始关卡
## make migration-status 只读查看迁移状态
## make build-wechat   构建微信小游戏（minigame 目录）
## make build-game     构建网页游戏
## make verify         检查 SQL、类型、规则、接口和后台构建
## make configure-game API_ENV=production API_URL=https://域名/api/v1  配置指定环境接口
## make images         构建三个生产镜像，可指定 IMAGE_PREFIX 和 IMAGE_TAG
## make images-push    推送指定版本的三个镜像
## make registry-login 登录镜像仓库，由 Docker 提示输入凭据
help:
	@sed -n 's/^## //p' Makefile
env-init:
	node scripts/env-init.mjs
export API_ENV API_URL API_LOCAL_URL API_PREVIEW_URL API_PRODUCTION_URL
configure-game:
	node scripts/configure-game.mjs
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
	node minigame/tools/test-player-profile.cjs
	node minigame/tools/test-custom-rules.cjs
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
test-audio:
	node minigame/tools/test-audio-assets.cjs
	node minigame/tools/test-soundscape.cjs
	AUDIO_AUTOPLAY=blocked node minigame/tools/test-soundscape.cjs
test-environments:
	node minigame/tools/test-api-environments.cjs
	node minigame/tools/test-api-storage.cjs
	node scripts/test-configure-game.cjs
preview-game:
	node minigame/tools/serve.cjs
test-ui:
	cd minigame && node tools/test-profile-ui.cjs
	cd minigame && node tools/test-toasts.cjs
	cd minigame && node tools/test-level-transition.cjs
	cd minigame && node tools/test-modals.cjs
	cd minigame && node tools/test-ui-skins.cjs
	cd minigame && node tools/smoke-test.cjs
	cd minigame && node tools/test-rapid-input.cjs
	cd minigame && node tools/test-loading.cjs
format:
	pnpm exec oxfmt --write .
	node scripts/format-templates.cjs --write
	gofmt -w backend
format-check:
	pnpm exec oxfmt --check .
	node scripts/format-templates.cjs --check
	@files="$$(gofmt -l backend)"; if [ -n "$$files" ]; then printf '%s\n' "$$files"; exit 1; fi
lint:
	pnpm exec oxlint --deny-warnings .
	node scripts/format-templates.cjs --lint
	go -C backend vet ./...
images: image-backend image-admin image-gateway
image-backend:
	docker build -f Dockerfile -t "$(IMAGE_PREFIX)/happy-pet-backend:$(IMAGE_TAG)" .
image-admin:
	docker build -f Dockerfile.admin -t "$(IMAGE_PREFIX)/happy-pet-admin:$(IMAGE_TAG)" .
image-gateway:
	docker build -f Dockerfile.gateway -t "$(IMAGE_PREFIX)/happy-pet-gateway:$(IMAGE_TAG)" .
images-push:
	docker push "$(IMAGE_PREFIX)/happy-pet-backend:$(IMAGE_TAG)"
	docker push "$(IMAGE_PREFIX)/happy-pet-admin:$(IMAGE_TAG)"
	docker push "$(IMAGE_PREFIX)/happy-pet-gateway:$(IMAGE_TAG)"
registry-login:
	docker login "$(IMAGE_REGISTRY)"
go-version:
	@node -e 'const m = require("node:fs").readFileSync("backend/go.mod", "utf8").match(/^go (\d+\.\d+)(?:\.\d+)?$$/m); if (!m) throw new Error("Cannot read Go version"); console.log(m[1] + ".x");'
ci-check:
	go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 -no-color .github/workflows/ci.yml
