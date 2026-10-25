# First Deployment Baseline Implementation Plan

**Goal:** Consolidate database creation for a first deployment, generalize initialization records, and migrate the existing local development data to the new baseline without losing business records.

**User decision:** Preserve local data and migrate its migration ledger to the new baseline. This explicitly replaces the previous incremental 000–005 migration lineage. Existing credentials and game data remain in place; no cloud deployment is requested.

**Architecture:** Keep `000_schema_migrations.sql` as the ledger bootstrap and merge all current business DDL and template seeds into `001_initial.sql`. Replace `level_catalog_seeds(entry)` with `system_initializations(init_key, recorded_at)`; namespaced keys `level_catalog:standard` and `level_catalog:campaign` retain prior initialization state. Use generic sqlc queries in `system.sql`. `recorded_at` is the write time; migrated legacy rows get the rebase time because the old table had no timestamp.

- [x] Archive original SQL and checksums under ignored artifacts before changing files.
- [x] Add regression tests for exactly two baseline migrations, all 11 tables, generic initialization keys, preserved catalog initialization and adoption of an already-populated exact baseline; run red.
- [x] Merge DDL using final constraints and the existing business column order. Remove superseded SQL files; update queries, runtime seeding, generated dbgen and documentation.
- [x] Replace the CI container test's obsolete version-002 upgrade case with populated-current-baseline restart checks; retain backup/restore and integrity checks.
- [x] Run full Go tests, sqlc consistency, formatting/lint and isolated fresh initialization checks.
- [x] Build the new API before stopping the old local process. Stop only this project's API, create a binary database backup, and restore it into a uniquely named rehearsal database.
- [x] Rehearse a transactional local conversion: verify old ledger checksums, rename/generalize initialization records, compare all business row counts and row hashes, compare schema to a freshly created baseline probe, then replace only the migration ledger with versions 000/001. Roll back on any discrepancy.
- [x] Run the same verified transaction on the local development database, restart the new API, verify health/migration status and unchanged business fingerprints. Remove only the rehearsal database created by this task.
- [x] Complete independent review and report the baseline files, table fields, checks and local backup location. Do not push or deploy.

## Local conversion evidence

The old migration sources/checksums are archived under ignored `artifacts/first-deploy-baseline-2026-10-25`. The binary database backup is `backups/first-deploy-baseline-2026-10-25/before-rebase-1792921210062.dump` (80,015 bytes). Rehearsal restored that backup to a fresh temporary database and validated the converted schema against a newly-created baseline probe before applying the identical transaction locally. All nine business tables matched before/after hashes, including after the new API started. Initialization markers became `level_catalog:campaign` and `level_catalog:standard`; metadata records now contain only migrations 000 and 001. Both temporary database and probe schemas were removed. The local API health check passed on port 8080. Independent code and one-time conversion review found no remaining issues.
