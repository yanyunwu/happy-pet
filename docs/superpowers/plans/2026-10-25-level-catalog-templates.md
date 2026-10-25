# Unified Level Catalog and Layout Templates Implementation Plan

> Database follow-up: the user subsequently requested a first-deployment baseline. The historical 005 migration described below is now merged into 001, and initialization records use `system_initializations`. See `2026-10-25-first-deployment-baseline.md` for the current migration layout and the data-preserving local conversion.

> **For agentic workers:** Use subagent-driven-development for isolated backend implementation and review; integrate the admin and minigame in the current workspace. Preserve all existing uncommitted woodland/audio/deployment work. Do not commit or push implicitly.

**Goal:** Manage challenge and campaign levels together, retain campaign progress, import reusable board layouts, and show a text-free woodland transition while requesting levels.

**Architecture:** Keep the existing `entry` discriminator (`standard` means 挑战模式; `campaign` means 闯关模式) so historical sessions and queued uploads stay compatible. Share level drafts, immutable published revisions, server rules, assets and replay. Layout templates are independent snapshots: import copies only columns, rows and layers into an editable draft.

**Tech Stack:** Existing Go/Gin/sqlc/PostgreSQL backend, React/Ant Design admin, Cocos Creator 3.8.8 TypeScript minigame.

## Agreed behavior

- The three original home buttons enter challenge rules; keep the separate campaign entry and three rule choices.
- Challenge starts a new round at its first enabled published level; currently each rule has two seeded levels. Remove the hard-coded two-stage database restriction for future configured extensions.
- Campaign starts at the first enabled published level the player has not cleared, per rule. Retry a loss or re-enter without a previous session continues that unfinished level. Completion of all published levels is a normal end state; newly published levels become playable later.
- Reuse `level_clears` for progress and first-clear rewards; new revisions keep the level identity. Do not reset player assets or past replays.
- Both catalogs use independent ordinals, editable drafts, publish validation and enable/disable actions. Keep technical positive-int32 bounds but remove the old 9999 level cap.
- Template payload: `{ id, name, layout: { columns, rows, layers: [{ z, cells: [{ x, y }] }] }, version, updatedAt }`. Templates have no mode, pet counts, reward or tool fields.
- Template APIs are admin-only: GET/POST `/admin/level-templates`, PUT/DELETE `/admin/level-templates/:id`. PUT body carries `version`; DELETE requires `?version=N`. Stale changes return 409.
- Layout validation shares the game geometry checks: 1–6 columns, 1–8 rows/layers, unique z=0..7, non-empty layers, half-grid integer positions within bounds, no same-layer overlap, total 3–192 cells. Pet-count divisibility is deliberately not part of template validation.
- Import is a deep copy of `layout`, never a live reference. Existing count mismatch warnings and publish validation remain. Editing/deleting a template cannot change an imported level.
- During level requests, show only a full-screen forest-colored leaf gathering animation, with input blocked and no labels, numbers or fake progress. Complete/failed requests dismiss it before showing the board or retry UI. Destroy/cancel invalidates stale callbacks.

## Task 1 — Backend catalog, progress and template persistence

Files: new migration `backend/sql/migrations/005_level_catalog_templates.sql`; `backend/sql/queries/game.sql`; generated dbgen; `backend/internal/game/{service,sessions,rules}.go`; shared `Layout` validation in `rules.go`, new `templates.go`; `backend/internal/httpapi/game.go`; integration tests.

- [x] Add HTTP regressions before implementation: admin sees six challenge and six campaign seeds; challenge draft editing/publish changes only challenge; same ordinal in two entries allowed; invalid entry and changing entry on existing ID rejected.
- [x] Add campaign progression cases: clear first, fresh start/retry returns second, independent rule starts first, challenge still restarts first, all-cleared returns `CAMPAIGN_COMPLETE`, publishing next level resumes it. Preserve first-clear reward idempotency.
- [x] Add template CRUD/auth/conflict tests and geometry-only validation (e.g. 5 cells accepted independent of three/four matching; overlaps rejected).
- [x] Run new tests red with `go -C backend test ./internal/httpapi -run 'TestLevelCatalog|TestLayoutTemplates|TestCampaignProgress' -count=1`.
- [x] Add only a new migration, removing the ordinal cap and standard-two-stage constraint and creating versioned `level_templates`. Generate sqlc; expose `entry` in LevelView/DraftInput (missing entry defaults campaign for old callers).
- [x] Extract `ValidateLayout(Layout{Columns, Rows, Layers})`, call it from `Validate(Config)`, keep count/rule validation in Config validation.
- [x] Implement template list/create/update/delete through existing admin auth, parameterized sqlc, optimistic version check; seed reusable layouts once with existing seed transaction and stable IDs.
- [x] Update Start/Finish target selection with shared semantics. Campaign excludes persisted cleared IDs; challenge uses `ordinal > previous.ordinal`. Keep ownership, settled win, entry and mode validation for next-session requests.
- [x] Run backend tests and sqlc consistency checks green.

## Task 2 — Shared admin editor and template management

Files: `admin/src/game-api.ts`, `pages/Levels.tsx`, new `pages/LevelTemplates.tsx`, new `components/LayoutEditor.tsx`, `components/Navigation.tsx`, `App.tsx`, existing admin stylesheet, `scripts/test-browser.cjs`.

- [x] Add `Entry` to Level and save request; present `standard` as 挑战模式 everywhere including records. Expose template client calls matching Task 1.
- [x] Add catalog tabs/filter and rule filter in one level list; editor creates under selected catalog. Existing identity is immutable. New ordinal is next within entry+rule; initial challenge remains its six rows.
- [x] Extract the current half-grid/layer painter into a reusable controlled LayoutEditor with the same CSS and accessible controls. Template editing shows only name/layout, live cell count and preview; list supports edit/delete with confirmation.
- [x] Replace the old buttons that copied entire level configs with a template picker and explicit import action. Apply `structuredClone(template.layout)` only, preserving rule/counts/tools/reward/title. Reset preview and active layer.
- [x] Browser regression: switch catalogs, save/publish a challenge draft, create a geometry-only template, import into a draft with distinctive counts/rewards/tools, assert those fields unchanged; edit/delete template and assert copied draft remains unchanged.
- [x] Run admin typecheck/build and actual browser flows against the isolated test server.

## Task 3 — Minigame transition and campaign UX

Files: new `minigame/assets/scripts/ui/LeafTransition.ts` and meta; `StarIsle.ts`; `core/OnlineClient.ts`; minigame regression scripts.

- [x] Add meaningful browser coverage with delayed and failed level responses: overlay contains zero Labels, covers screen, blocks clicks, disappears on success/error; retry and subsequent level remain usable.
- [x] Implement a self-contained transition presenter with owned node/tweens, generation token, minimum visible interval, fade-out and destroy cleanup. Use existing vector leaves and woodland palette; no new raster assets.
- [x] Wrap startCloud requests (including next level) in the transition. Remove Connecting dialog text. Mount the resulting board under the cover, then dismiss. Failures show the existing retry dialog after dismissal; `CAMPAIGN_COMPLETE` shows normal completion/return-home UI.
- [x] Retain OnlineError server code. Update campaign intro/restart/result labels for persisted progress; challenge labels retain restarting from level one. Do not change game rules or home entry arrangement.
- [x] Run minigame typecheck, rule/network regressions, build web and WeChat sequentially, then actual browser integration/startup checks.

## Completion

- [x] Review requirements first, then code quality; fix material findings.
- [x] Run oxfmt, oxlint, typecheck, sqlc checks, targeted and full backend tests, admin build and browser QA.
- [x] Apply migration to this project's local development database using existing API startup process; restart only this project's API, preserve data. Keep admin 5173/API 8080 and local minigame API URL.
- [x] Update README with catalog/progress/template semantics and provide local admin/game preview links and screenshots. No cloud deployment or push requested.

## User extension — configurable elimination patterns

The user subsequently requested arbitrary same-kind multiplicity patterns, with multiple patterns active in one level. Keep classic/quartet/fun as home entry classifications; actual elimination comes from a level's ordered `rules: number[][]`. `3` means three of one kind; `3+2` means three of one kind and two of a different kind. Each rule totals 2–7 tiles for the existing seven-slot tray; up to six rows, no normalized duplicates. Per-pattern numbers normalize descending while row order determines matching priority.

- [x] Add pet-rules-2 Config/State rules in backend, retaining legacy v1 defaults for saved sessions/revisions. Validate and generate against active patterns; reject rule-preempted unsolvable distributions such as four identical tiles with rules 3 and 4.
- [x] Use deterministic first-appearance kind assignment in both Go and TypeScript. New board generation, reshuffle, picking, hints, terminal states, publish checks and replay snapshots must agree; bounded decomposition reports complexity limits instead of hanging.
- [x] Add an editable/reorderable rule list to admin levels, explicitly separate from home entry classification. Template import still touches geometry only. Disable editing during save so delayed responses cannot erase unsaved changes.
- [x] Derive the game's rule instructions/examples and quick-reference label from actual rules. Keep offline default configurations, home buttons and historical game compatibility.
- [x] Test custom 3,4,2+2,3+2,2+2+2,2+1 patterns, priorities, distinct types, seven-slot handling, legacy sessions and cross-language replay parity. Build and rerun end-to-end custom publish/play tests.

## Verification recorded

Backend full tests and sqlc checks passed. Admin and game typechecking, oxfmt/oxlint, web/WeChat builds and startup checks passed. Browser integration covers 12 complete flows, including editable challenge levels, template CRUD/import isolation, campaign retry progress, custom 3+2 play and preserved replay rules. Custom rules agree with exhaustive ordered play on 1,122 small distributions and 610 server/client replay steps. Native UI, six offline stages, rapid input, loading recovery and the existing soundscape regressions passed. Independent specification and quality reviews are closed, including delayed-response session cancellation and disabled numeric steppers during saves. Local API runs on 8080 and admin on 5173; migration 005 was applied to the development database. No cloud deployment or push was performed; phone WeChat has not been re-tested.
