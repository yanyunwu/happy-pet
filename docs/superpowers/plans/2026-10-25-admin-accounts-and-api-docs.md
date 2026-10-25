# Admin accounts and API documentation implementation plan

> For agentic workers: use subagent-driven-development for isolated implementation tasks, then review the integrated changes. Preserve the existing uncommitted single-rule changes.

**Goal:** Separate administrators from players, add personal password/access-token settings, expose every API in Swagger, and serve a complete root SKILL.md through the gateway.

**Architecture:** PostgreSQL migration 004 creates `admin_accounts`, migrates existing administrators with their password hashes and audit IDs, and removes administrator authority from `users`. An administrator session and a hashed opaque access token share the administrator principal; player bearer sessions remain separate. Swagger uses a versioned OpenAPI document checked against the live Gin route inventory; gateway serves the root Markdown document directly.

**Tech stack:** Go/Gin, PostgreSQL/sqlc, React/Ant Design, local Swagger UI assets, nginx.

## Shared contract

- Admin view: `id, username, nickname, status, remark, createdAt, updatedAt, lastLoginAt, deletedAt`; optional `role: "admin"` for compatibility, never password/token hashes.
- Existing `POST /api/v1/admin/auth/login`, `GET /api/v1/admin/auth/me`, and `POST /api/v1/admin/auth/logout` keep cookie sessions and now operate on admin accounts.
- `POST /api/v1/admin/auth/password`: `{currentPassword,password}`, returns 204, changes own password, revokes existing sessions and access token, clears cookie. Password remains 10–72 UTF-8 bytes.
- `GET /api/v1/admin/auth/access-token`: `{configured:boolean,hint:string,updatedAt:string|null}`.
- `PUT /api/v1/admin/auth/access-token`: `{accessToken?:string}`; omitted/empty creates a cryptographically random token, supplied value is 32–128 printable ASCII characters without whitespace. Returns `{accessToken,hint,updatedAt}` once. Store only SHA-256 digest plus a masked hint/timestamp. Rotation immediately invalidates the previous token; digest uniqueness prevents ambiguous ownership.
- `DELETE /api/v1/admin/auth/access-token`: 204, revokes token.
- Separate administrator management: `/api/v1/admin/accounts` GET paginated list (`q,status,page,pageSize`), POST `{username,password,nickname,remark}`; `/accounts/:id` GET/PATCH `{nickname,status,remark}`/DELETE; POST `/accounts/:id/restore`; POST `/accounts/:id/password` `{password}`. Protect the last active administrator, invalidate sessions/tokens after disabling/deleting/resetting password.
- `/admin/users` now creates/manages only players, with its existing data contract; it grants no administrator privileges. Admin UI has a separate administrator account menu/page.
- `Authorization: Bearer <access_token>` authorizes every protected API. Explicit bearer credentials take precedence over cookie credentials; invalid bearer credentials must not fall back to a valid cookie.
- For `/api/v1/user/*`, an admin access token must include `X-User-ID` of the intended active, nondeleted player. No administrator is implicitly converted into a player. Player JWTs cannot impersonate another player with this header. Existing owner checks/game rules still apply to the target player.
- Anonymous health/login/public-announcement/info routes keep their original contracts; a token never bypasses required request fields or business rules.
- Read-only `GET /api/v1/openapi.json` serves a complete OpenAPI 3 document. Admin `/api-docs` page uses local Swagger UI, offers Bearer authorization, and links `/admin/SKILL.md`; no persisted token or CDN dependencies.
- Gateway exact `/admin/SKILL.md` route serves the repository-root file as `text/markdown; charset=utf-8`, no SPA fallback, no secrets. Include it in the gateway image; support local admin dev/build preview where practical.

## Migration requirements

- Add a new migration; never change previously applied SQL files/checksums.
- Copy every existing admin account into `admin_accounts` preserving login hashes, status, timestamps, ID, and deleted state. Invalidate old admin JWTs through a separate admin audience/issuer or other principal-specific mechanism.
- Remove administrator-only records from `users` when they have no player identity/data. Preserve real WeChat identity, asset balances/ledger and game sessions by retaining a role=user player record when needed; it must have no administrator privilege. Never delete gameplay history to achieve table separation.
- Fresh bootstrap writes only the admin table. Existing deployments validate admin presence in that table.

## Tasks

- [x] Backend: write regression tests for separation/migration, normal-player nonpromotion, password reset/session invalidation, token generation/custom/rotation/revocation, disabled admins, all route families and explicit player targeting; observe failure, implement migration/sqlc/services/routes, run full Go suite.
- [x] Admin: personal settings modal with password confirmation and token create/set/copy/revoke; clear password/token values on close; separate administrator page; Swagger navigation/page with loading/error handling and local assets. Update affected browser expectations and run typecheck/build.
- [x] Docs: author accurate OpenAPI schemas/examples for every current/new route and detailed root SKILL.md including auth, curl examples, inputs/outputs, pagination, idempotency, concurrency, gameplay event sequences and errors. Add automatic route coverage/document checks.
- [x] Gateway: exact static Markdown route + Docker copy; verify response through nginx and that SPA does not intercept it.
- [x] Integration: browser test login, separated lists, modal, token access, password change, Swagger loading and operation inventory; full backend tests, formatting, SQL generation checks, admin build.
- [x] Review: independent spec/security/quality review, repair findings, update this checklist with actual verification outcomes. Do not commit or push unless requested.

## Verification record

- Full Go suite passed; administrator identity/token/migration tests also independently passed. SQL generation vet/diff and Go vet passed.
- Admin typecheck, build, formatting, lint, focused UI contract checks and incorrect-current-password regression passed.
- Real database-backed browser test passed (16.46 s): separate account creation, token generate/custom/revoke, player targeting, all 55 Swagger operations rendered, public and authorized Try It Out, raw SKILL content, password invalidation and mobile modal.
- Existing admin/Cocos browser regression passed (52.99 s), including all 12 gameplay/catalog/asset/replay flows and the single-rule editor checks.
- Complete isolated Docker suite passed all 8 groups: image builds, initialization rollback, gateway/static/API behavior, token forwarding, database backup/restore and restart preservation. The final admin image was rebuilt and nginx configuration validated after the form-label fix.
- OpenAPI validates structurally; all 99 schema/request/response examples validate. Live Gin routes, OpenAPI and SKILL match all 55 operations. Root skill validator passed.
- Review findings resolved: overlapping config schemas use anyOf; Swagger srcdoc uses its real document URL; account forms have distinct IDs; wrong current-password errors preserve the session; Markdown responses explicitly include UTF-8.
- Local database upgraded from version 2 to 4 after verified archive `backups/before-admin-separation-2026-10-25T13-54-33-798Z.dump`. Administrator IDs/password hashes remained equal; 1 administrator and 1 player are separate, 48 sessions, 12 levels, 1 asset record and 6 ledger records retained. Previously deployed migrations were not modified.
- No commits, pushes or production deployment performed for this task.
