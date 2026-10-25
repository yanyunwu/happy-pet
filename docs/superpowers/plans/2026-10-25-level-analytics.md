# Level analytics implementation plan

**Goal:** Add a working 数据分析 action to every level row, with trustworthy per-level results and a readable, responsive analysis drawer.

**Architecture:** Aggregate existing server-validated sessions and events in PostgreSQL through an authenticated admin endpoint. The React drawer requests analytics only while open. A small native SVG chart and existing Ant Design components keep the existing admin theme and avoid another chart dependency.

**Tech stack:** Go/Gin, PostgreSQL, sqlc, React/TypeScript, Ant Design, existing Playwright browser integration.

## Design and API contract

- Use a drawer so the operator keeps the current level-list tab, filter and page. A separate route would add unnecessary navigation; an inline expanded row would squeeze charts into the table.
- Every persisted row, including an unpublished draft, has 数据分析. Empty samples show 暂无对局数据 and undefined rates/durations display —.
- `GET /api/v1/admin/levels/{id}/analytics?range=30d&revisionId=...`; `range` is `7d`, `30d` (default), `90d`, or `all`; missing/empty revision means all published versions. Unknown ranges and revisions not belonging to this level return 400; absent level returns 404. Existing administrator cookie and access-token authorization applies; players cannot access this endpoint.
- Filter by session **start time**, independent of settlement time. Calendar boundaries and daily groups use Asia/Shanghai. A rolling period includes today and its preceding N−1 calendar days, ending at the request timestamp (exclusive). `all` covers all stored sessions. For `all`, totals cover all history while the trend is explicitly labelled 最近 90 天趋势.
- Main through rate = `won / attempts * 100`; finished through rate = `won / (won + lost + abandoned) * 100`. A zero denominator is null. `playing` means 未结束, including disconnected or idle sessions, never inferred failure.
- Unique players are distinct user IDs within the selected cohort. Average win moves uses won sessions. Average win duration uses won sessions with valid `ended_at >= started_at`, in server wall-clock seconds (including background/idle time); missing measurements are null and the measured sample count is returned.
- Tool usage counts validated events `undo`, `shovel`, `hint`, `shuffle`, `unlock_slot`, including free and bag tools; return all five rows even when zero. Do not infer completed ads from slot-unlock events.
- All queries use the same read-only repeatable-read snapshot. Add a new migration with an index on `(level_id, started_at DESC)` without changing existing migrations or player history.

Response fields:

```ts
interface LevelAnalytics {
  level: {
    id: string;
    title: string;
    entry: 'standard' | 'campaign';
    mode: 'classic' | 'quartet' | 'fun';
    ordinal: number;
    publishedRevisionId: string;
  };
  range: '7d' | '30d' | '90d' | 'all';
  revisionId: string;
  from: string | null; // RFC3339; null for all history
  to: string; // RFC3339, exclusive
  trendFrom: string; // YYYY-MM-DD
  timezone: 'Asia/Shanghai';
  generatedAt: string; // RFC3339
  summary: {
    attempts: number;
    players: number;
    won: number;
    lost: number;
    abandoned: number;
    unfinished: number;
    winRate: number | null;
    finishedWinRate: number | null;
    avgWinDurationSeconds: number | null;
    winDurationSamples: number;
    avgWinMoves: number | null;
  };
  daily: {
    date: string;
    attempts: number;
    won: number;
    lost: number;
    abandoned: number;
    unfinished: number;
    winRate: number | null;
  }[];
  revisions: {
    id: string;
    version: number;
    title: string;
    publishedAt: string;
    current: boolean;
  }[];
  tools: {
    type: 'undo' | 'shovel' | 'hint' | 'shuffle' | 'unlock_slot';
    uses: number;
    sessions: number;
  }[];
}
```

## Implementation and verification

- [x] Backend: write isolated database/HTTP regression fixtures and observe the missing endpoint failure; implement SQL aggregates, typed service, route, migration and generated queries. Cover empty samples, repeat attempts by one player, all four outcomes, unrelated levels, version/time filters, Shanghai midnight, tool event counts, missing duration, invalid inputs and authentication.
- [x] Frontend: add typed analytics client and dedicated drawer/chart modules, a row action, outcome counts, six summary metrics, daily trend/table and tool counts. Show the statistical definitions in plain Chinese. Abort or ignore superseded requests, clear old results on filter changes, provide loading/error/retry/empty states, retain list context, and support mobile width.
- [x] Browser verification: test row entry and selected-level title, real data/rates, filters, empty draft, failed request/retry, stale responses and narrow layouts. Use the built admin against an isolated API database for the main flow and bounded mocks for network failure/race cases.
- [x] Documentation: update OpenAPI and root SKILL.md with full fields, examples, formulas, filters and errors; keep live-route coverage and operation counts consistent.
- [x] Integration: run focused/full Go checks, sqlc vet/diff, typecheck, formatting/lint, admin build and browser checks. Independently review specification coverage, then code quality. Do not commit or push this new feature unless requested.

## Verification results

- `make test-api`: full Go suite passed, including migration history, administrator authorization, analytics and OpenAPI/live-route/SKILL coverage.
- `make sqlc-check`, `make format-check lint`, `make build-admin`, `make build-api`: passed. Admin build includes TypeScript checking; the existing bundle-size advisory remains.
- `make test-level-analytics-browser`: controlled failure/race cases and the built admin against an isolated PostgreSQL-backed API passed. Tests cover all six metrics, tool counts, daily details, all-history and revision filters, empty drafts and mobile width.
- `node scripts/test-single-rule-form.cjs`: existing rule editing/save/preview/reopen regression passed.
- Independent specification and code-quality reviews approved. Review-found mobile issues were fixed: compact action menu preserves level names at 320/390px, and a responsive SVG viewBox keeps chart labels readable. Screenshots are under `artifacts/qa-level-analytics` and `artifacts/level-analytics-integration`.

## Scope limits

Only sessions uploaded to the server are measurable; offline practice is not counted. No synthetic win probabilities, player tracking changes, data backfill or forced conversion of unfinished sessions. The current feature changes the admin/API only, so the WeChat package does not need rebuilding.
