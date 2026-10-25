# MiniGame API Environment Selection Plan

**Goal:** Select the correct API address automatically in the local, phone preview/experience builds and production, using one game package.

**Addresses approved by the user:** local `http://127.0.0.1:8080/api/v1`; preview and production both `https://hp.autora.cn/api/v1`.

**Architecture:** A pure TypeScript resolver reads WeChat's documented account/device APIs. Per the user's latest clarification, only browsers and `platform=devtools` select local; native `develop` and `trial` select preview; `release` and unidentified WeChat versions select production. Both preview and production use the approved online endpoint. Simulator detection takes priority over version detection. Browser-only preview retains offline practice. Configuration remains packaged in `online.json` under `environments.<name>.apiBaseUrl`; runtime code does not depend on Node's `process.env` or URL globals.

- [x] Add failing unit tests for environment detection, older device API fallback, production-safe fallback, URL normalization and invalid configuration.
- [x] Implement the resolver, configure all three addresses, integrate it into startup, and update WeChat build settings to use the local address when deciding local URL checks.
- [x] Scope pending event queues and start-request keys by normalized API URL. Migrate old unscoped entries only for the original known loopback endpoint; leave unknown-origin legacy data intact rather than transmitting it to a different server. Add retry/isolation regressions.
- [x] Extend `configure-game` with `API_ENV` + `API_URL` and individual `API_LOCAL_URL`, `API_PREVIEW_URL`, `API_PRODUCTION_URL` overrides. `API_URL` without `API_ENV` targets production. Preserve other environment settings and validate before writing. Add temporary-directory command tests.
- [x] Update README, deployment instructions, Makefile and existing browser test mocks for the new configuration shape.
- [x] Verify selection in an actual exported Cocos page with mocked WeChat metadata/transport. Keep all requests inside the test and close the temporary preview server afterwards. Build web and WeChat sequentially, validate startup, lint and typecheck the changed game code.
- [x] Independently review the change, report the selected URLs and verification. Do not restart the user's stopped API, database or admin services, and do not push unless requested.

Official reference: [WeChat MiniGame API definitions](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts), including `miniProgram.envVersion` and device `platform`.

## Verification

Environment detection, API-scoped storage (including WeChat empty-string/undefined missing values), CLI configuration and actual Make invocation passed. CLI and runtime share the same pure TypeScript URL validator under Node 24, with standard IP normalization and loopback/invalid-address checks. Eight exported-Cocos runtime scenarios selected the expected login URLs without making real API requests. Web and WeChat builds, six startup checks, 610 existing client/server parity steps, game typechecking and repository lint/format checks passed. The supplied public API health endpoint returned status ok. Local API/admin/game-preview/database services remain stopped; no push or cloud deployment was performed. Physical-phone behavior was not directly tested.
