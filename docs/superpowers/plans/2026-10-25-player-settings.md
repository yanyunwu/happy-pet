# Woodland menu, player settings and selected voice

**Goal:** Match the menu artwork to the forest theme, let a WeChat player set their nickname and synchronize their WeChat avatar, and replace all four spoken cues with audition A.

**Confirmed choices:** The user wants WeChat avatars only (no pet picker or photo upload). Voice A is `zh-CN-XiaoyiNeural`. Keep the earlier environment, autoplay, toolbar and top-notice changes.

**Profile contract:** Existing `GET /api/v1/user/me` returns `id`, `nickname`, `avatarUrl` among the user fields. Add authenticated `PUT /api/v1/user/me` (keep PATCH as a compatibility alias; native WeChat requests do not support PATCH) accepting `{ nickname: string, avatarUrl?: string }`. Nicknames contain 1–32 Unicode characters after trimming. Omitted avatar preserves the current value. Store an authorized WeChat avatar URL in a dedicated new `users.avatar_url` field; accept only HTTPS WeChat image hosts, normalize legacy HTTP WeChat URLs to HTTPS, and reject credentials, foreign hosts, fragments and invalid values. No server-side downloading or media hosting. Keep existing `avatar_media_id` compatibility. Add migration 002; never rewrite applied baseline 001.

**Client/UI:** The home menu has four inset wooden rows: personal settings, system settings, customer service, announcements. Use real textured woodland artwork for customer service and announcements. Personal settings shows a framed avatar, editable nickname, an explicit WeChat avatar authorization button, and a save button. Synchronization updates a draft only; saving writes the authenticated account and updates the displayed profile. Refusal, cancellation, unsupported browser preview, missing avatars and image errors are handled without losing stored details. Destroy/hide native authorization controls on close, scene changes, backgrounding and destruction; stale callbacks must not change a new screen. Keep nickname editing via the existing Cocos UI/keyboard facilities.

**Avatar lifetime:** The official WeChat `UserInfo.avatarUrl` documentation says the old URL can expire when the user changes their avatar. Use a local default illustration on image failure and let the user explicitly synchronize again. Authorization is requested only on the personal-settings action.

**Work allocation:** Independent backend and selected-voice changes may be implemented by subagents using the subagent-driven-development workflow. The parent owns menu art, profile dialog, OnlineClient integration and browser QA. No agent commits or pushes; preserve the shared uncommitted work.

- [x] Backend: profile update, URL validation, migration/query regeneration, isolation/persistence/admin-view tests and fresh/upgrade migration checks using an isolated temporary database.
- [x] Voice: generate four Xiaoyi cues, preserve background music/effects, update the reproducible voice source and manifest, decode and validate all audio assets.
- [x] Art/UI: generate matching support/announcement icons, add the personal-settings entry and dialog, synchronize/save through OnlineClient, and maintain native-control lifecycle.
- [x] Verify: meaningful client/profile tests, screenshots of menu/personal settings, relevant existing regressions, lint/format/types, sequential Cocos web and WeChat builds, startup checks and independent review. Stop temporary services and document any WeChat-console/real-device requirements.

## Verification and delivery

The initial browser regression failed because the menu had no personal-settings entry. Final exported-game tests cover all four menu entries, real nickname input, draft-only avatar synchronization, successful save/reopen, failed save preservation, failed image decoding followed by Save, native controls on background/foreground/close, stale callbacks, a 401 account switch followed by repeat Save, and an account switch while idle. All passed. The 16 client/native-boundary tests, existing online/storage regressions, full Go suite, SQL generation checks, repository lint/format checks, game TypeScript, modal/skin regressions, eight gameplay smoke flows, audio asset/playback tests and six WeChat startup checks passed. Web and WeChat builds succeeded sequentially.

Independent spec and quality review found three integration issues that were corrected and verified: WeChat needs PUT rather than PATCH; drafts must remain bound to the account that loaded them; and failed avatar candidates must not replace a saved avatar. The Cocos Mask module is enabled, and the EditBox is configured before activation so the correct native input and labels are created.

All 18 music/effect files and all 22 existing audio metadata files remain byte-identical; four spoken cues now use audition A. The two generated PNG originals, packaged sprites and full built-in image_gen prompts are recorded in `minigame/art/menu-icons-2026-10-25.json`. UI screenshots are in `minigame/output/qa-profile/`.

Temporary PostgreSQL containers were removed and the task's preview server was stopped; pre-existing services were left as found. No commit, push, cloud deployment or actual-phone authorization was performed. Deploy the backend with migration 002 together with the new client; WeChat privacy/download-domain setup and actual-device authorization remain environment verification items.
