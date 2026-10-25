# Forest Top Notice Implementation Plan

**Goal:** Give every transient game notice one readable woodland presentation near the top of the screen.

**Architecture:** Extract the existing `StarIsle.toast` presentation into `ui/ToastPresenter.ts`. Keep every caller on the existing `toast(message)` entry point. Reuse the light wood `nav` skin, add a green leaf medallion, and use wrapped dark green text. Keep one active notice, replace its text and renew its lifetime without a second entrance flash. The notice has no input listeners or blocking component. Clear it on screen changes and destruction; keep it above dialogs and below the text-free level-loading cover.

**Layout and motion:** Use the 720 × 1560 design coordinates. Start below the main top bar at y = 196, respect additional safe-area insets, and keep 32-pixel side margins. A light wood plate grows vertically for wrapped text, with a maximum of three text lines. Enter over 0.22 seconds from 18 pixels above, show for 2.6–5 seconds according to message length, and fade upward over 0.22 seconds. Repeated notices reuse the same node and cancel the previous expiration.

**Tech stack:** Existing Cocos Creator 3.8.8 TypeScript, authored scene skin frames, Cocos Graphics/Label/Tween, Playwright against the actual exported game.

- [x] Add `minigame/tools/test-toasts.cjs`; reproduce the old notice appearing around y = 1000. Check top placement, stable replacement, wrapping, lifetime, modal layering, input pass-through, safe insets and screen cleanup.
- [x] Implement `ToastPresenter.ts` and its Creator metadata. Integrate with `StarIsle` initialization, the shared toast entry point, dialog/menu ordering and teardown. Retain the existing API, audio and toolbar changes.
- [x] Add the notice regression to `make test-ui`. Build web, run the notice and existing modal regressions, and inspect home/game/modal screenshots at phone dimensions. Check formatting, lint and game types.
- [x] Build WeChat sequentially after web and run its startup checks. Stop the task's temporary preview server. Record evidence here and deliver a preview; do not publish or push without a request.

## Verification

The old exported game failed the new top-placement assertion before implementation. After rebuilding, all seven notice scenarios and the existing modal regression passed. Home, long-text, gameplay and modal screenshots were visually inspected at a 432 × 936 phone viewport; a cropped preview is saved at `minigame/output/qa-toasts/preview.png`. Game typechecking, targeted lint/format checks and an independent read-only review passed. Web and WeChat builds succeeded; package validation and six WeChat startup checks passed. The temporary preview server was stopped. No physical-phone run, publication or push was performed.
