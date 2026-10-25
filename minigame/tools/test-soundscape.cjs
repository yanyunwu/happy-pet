const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({
    viewport: { width: 432, height: 936 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:7457/?qa=soundscape', { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate(
      () =>
        (window.audioApp = cc.director
          .getScene()
          .getChildByName('StarIsleGame')
          .getComponent('StarIsle')),
    );
    assert(
      await page.evaluate(() => !!window.audioApp.soundscape),
      'The woodland audio director must be installed',
    );
    await page.waitForFunction(() => window.audioApp.soundscape.loadedCount === 22);
    assert.equal(
      await page.evaluate(() => window.audioApp.soundscape.unlocked),
      false,
      'no autoplay before a gesture',
    );
    await page.mouse.click(56 * 0.6, 75 * 0.6);
    await page.waitForFunction(() =>
      window.audioApp.soundscape.musicSlots.some((slot) => slot.source.playing),
    );
    assert.equal(await page.evaluate(() => window.audioApp.soundscape.mode), 'home');
    await page.evaluate(() => window.audioApp.closeModal());
    await page.waitForFunction(() => !window.audioApp.modal);
    await page.mouse.click(185 * 0.6, 1220 * 0.6);
    await page.waitForFunction(
      () =>
        window.audioApp.modal?.name === 'Rules' &&
        Math.abs(window.audioApp.modal.scale.x - 1) < 0.001,
    );
    await page.mouse.click(360 * 0.6, 1203 * 0.6);
    await page.waitForFunction(
      () => !window.audioApp.modal && window.audioApp.soundscape.voice.playing,
    );
    assert.equal(await page.evaluate(() => window.audioApp.soundscape.mode), 'game');
    assert(
      await page.evaluate(() => window.audioApp.soundscape.ducking),
      'speech ducks background music',
    );
    await page.waitForFunction(() =>
      window.audioApp.soundscape.musicSlots
        .filter((slot) => slot.target === 1)
        .every((slot) => slot.source.volume < 0.12),
    );
    const voiceDuration = await page.evaluate(() => window.audioApp.soundscape.voice.duration);
    await page.waitForFunction(() => !window.audioApp.soundscape.ducking, null, {
      timeout: (voiceDuration + 1) * 1000,
    });
    await page.waitForFunction(() =>
      window.audioApp.soundscape.musicSlots.some(
        (slot) => slot.target === 1 && slot.source.volume > 0.18,
      ),
    );
    const ids = await page.evaluate(() => {
      const groups = new Map();
      for (const tile of window.audioApp.game.availableTiles()) {
        const list = groups.get(tile.kind) || [];
        list.push(tile.id);
        groups.set(tile.kind, list);
      }
      return Array.from(groups.values())
        .find((group) => group.length >= 3)
        .slice(0, 3);
    });
    for (const id of ids) {
      const p = await page.evaluate((id) => {
        const n = window.audioApp.tileNodes.get(id);
        return { x: n.position.x, y: -n.position.y };
      }, id);
      await page.mouse.click(p.x * 0.6, p.y * 0.6);
    }
    await page.waitForFunction(() =>
      window.audioApp.effects.children.some((n) => n.name === 'LeafParticle'),
    );
    fs.mkdirSync(path.resolve(__dirname, '../output/qa-audio'), { recursive: true });
    await page.screenshot({
      path: path.resolve(__dirname, '../output/qa-audio/woodland-match.png'),
    });
    await page.mouse.click(56 * 0.6, 77 * 0.6);
    await page.waitForFunction(
      () =>
        window.audioApp.modal?.name === 'Settings' &&
        Math.abs(window.audioApp.modal.scale.x - 1) < 0.001,
    );
    await page.mouse.click(360 * 0.6, 858 * 0.6);
    await page.waitForFunction(
      () =>
        !window.audioApp.save.sound &&
        !window.audioApp.soundscape.voice.playing &&
        window.audioApp.soundscape.musicSlots.every((slot) => !slot.source.playing) &&
        window.audioApp.soundscape.effects.every((source) => !source.playing),
    );
    await page.mouse.click(360 * 0.6, 858 * 0.6);
    await page.waitForFunction(
      () =>
        window.audioApp.save.sound &&
        window.audioApp.soundscape.musicSlots.some((slot) => slot.source.playing),
    );
    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_HIDE));
    assert(
      await page.evaluate(() => {
        const audio = window.audioApp.soundscape;
        return (
          !audio.voice.playing &&
          audio.musicSlots.every((slot) => !slot.source.playing) &&
          audio.effects.every((source) => !source.playing)
        );
      }),
      'all sound stops when the game enters the background',
    );
    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_SHOW));
    await page.waitForFunction(() =>
      window.audioApp.soundscape.musicSlots.some(
        (slot) => slot.name === 'music' && slot.source.playing,
      ),
    );
    await page.mouse.click(360 * 0.6, 1080 * 0.6);
    await page.waitForFunction(
      () => window.audioApp.currentScreen === 'home' && window.audioApp.soundscape.mode === 'home',
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.resolve(__dirname, '../output/qa-audio/result.json'),
      JSON.stringify(
        {
          success: true,
          checks: [
            '22 clips loaded',
            'gesture-gated music',
            'home/game music',
            'voice ducking and recovery',
            'leaf match effects',
            'mute stops all channels',
            'background stops sound and foreground resumes game music',
            'unmute and home transition',
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS — woodland audio, speech ducking, music transitions, mute controls and leaf effects.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
