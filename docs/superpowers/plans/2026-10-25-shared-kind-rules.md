# Shared-kind combination rules implementation plan

**Goal:** Allow several groups in one combination to use the same pet kind, while preserving each group's required count and consuming every tile only once.

**Architecture:** Expand each configured pattern into its distinct merged-count patterns (for example, `2+2+2` becomes `2+2+2`, `4+2`, or `6`) and use the same effective patterns for matching, generation, hints and shuffle. Keep stored authoring rules unchanged, retain configured rule priority, and try the original distinct-kind pattern before merged alternatives. Both Go and TypeScript must use identical deterministic expansion order.

**Tech stack:** Existing Go rule service, TypeScript game engine, React rule editor, Node/Go tests, Cocos Creator 3.8.8.

## Accepted behavior

- A group contains identical pets; separate groups may share a kind. `2+2` accepts AABB and AAAA, not AAAB. `1+3` accepts AAAB and AAAA, not AABB. `2+2+2` accepts AABBCC, AAAABB and AAAAAA.
- A tile cannot fill two positions. A partial group never clears; matches still clear before the full-tray loss check.
- Existing one-group rules (3, 4 and other counts), rule priority, game/tool policies and the one-authoring-rule limit remain.
- Expand each original rule in order; enumerate separate groups first, then merge a group's amount into each previously formed group in order, skipping equal group sums. Canonicalize each result descending and deduplicate, preserving first occurrence.
- For pure `2+2`, counts must be nonnegative and even, and the total divisible by four. A kind may exceed half the board; pair groups may use that kind twice.
- Generic decomposition and hints operate on expanded patterns and validate actual arrival order, avoiding preempted matches in historical multi-rule configurations.
- Existing API rule representation and accepted version labels remain. No saved game, recorded event, published revision or reward is rewritten. Both game and API builds must be updated for the new semantics.

## Work and verification

- [x] Write failing Go matching, generator/shuffle and HTTP authoring/event tests; implement effective patterns and pair grouping in the backend.
- [x] Write failing TypeScript matching/hint/shuffle tests, including partial merging, negatives and no tile reuse. Implement the same expansion and pure-pair behavior; retain exhaustive generator comparisons.
- [x] Update game rule help, mode descriptions, admin editor help and API/user documentation to explain that groups may share a kind.
- [x] Review backend specification coverage, then cross-language code quality; verify matching order and legacy-rule behavior.
- [x] Run Go, game and rule-editor checks, typechecking, lint/formatting and builds. Rebuild web and WeChat outputs and verify gameplay plus startup. Keep the earlier analytics and sign-in changes intact; no commit or push without a request.

## Verification results

- Backend full Go suite passed, including shared-kind save → preview → publish → start → events → finish; focused shared-kind HTTP checks independently rerun successfully.
- `make test-game` passed, including 1,122 exhaustive custom-generator comparisons and seeded board/shuffle checks. Updated Go fixtures and `test-online.cjs` verified 783 server/client action steps.
- The probability calculator uses the same merge ordering, bounds combinations to the game's 2–7 tiles and passes exact probability, negative mixture and exhaustive permutation checks.
- `make typecheck`, formatting/lint/vet, admin/API builds and the existing rule-editor form regression passed.
- Web and WeChat builds passed. `test-shared-kind-ui.cjs` confirmed actual exported-game clicks for same-kind 2+2 and 1+3, partial 2+2+2, invalid mixtures and help text. Screenshots are under `minigame/output/qa-shared-kind`.
- WeChat build validation and all six startup checks passed. Independent specification and code-quality reviews approved without remaining findings.

Deployment must update the backend and game client together so both apply the broader existing-rule semantics. No stored data migration or rewrite is required.
