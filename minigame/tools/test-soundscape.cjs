const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const autoplayBlocked = process.env.AUDIO_AUTOPLAY === 'blocked';
const origin = process.env.GAME_PREVIEW_URL || 'http://127.0.0.1:7457';
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      `--autoplay-policy=${autoplayBlocked ? 'document-user-activation-required' : 'no-user-gesture-required'}`,
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 432, height: 936 },
    deviceScaleFactor: 1,
  });
  const session = await page.context().newCDPSession(page);
  // Playwright evaluate/waitForFunction grant user activation. Startup probes must not.
  const inspect = async (fn) => {
    const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`,
      returnByValue: true,
      userGesture: false,
    });
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
    return result.value;
  };
  const waitForInitial = async (predicate) => {
    const deadline = Date.now() + 30000;
    while (!(await inspect(predicate))) {
      if (Date.now() > deadline) throw new Error('Audio startup timed out without user activation');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/?qa=soundscape`, { waitUntil: 'networkidle' });
    await waitForInitial(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await inspect(() => {
      window.audioApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      return true;
    });
    assert(
      await inspect(() => !!window.audioApp.soundscape),
      'The woodland audio director must be installed',
    );
    await waitForInitial(() => window.audioApp.soundscape.loadedCount === 22);
    assert.equal(
      await inspect(() => window.audioApp.soundscape.unlocked),
      false,
      'no game interaction before the startup music check',
    );
    assert(
      await inspect(() =>
        window.audioApp.soundscape.musicSlots.some(
          (slot) => slot.name === 'music-home' && slot.target === 1,
        ),
      ),
      'request home music as soon as its resource is loaded, without a gesture',
    );
    if (autoplayBlocked) {
      assert(
        await inspect(() =>
          window.audioApp.soundscape.musicSlots.every((slot) => !slot.source.playing),
        ),
        'respect the browser autoplay restriction',
      );
      // The blank canvas is not a game button: Cocos must resume the queued BGM itself.
      await page.mouse.click(360 * 0.6, 1100 * 0.6);
    } else {
      await waitForInitial(() =>
        window.audioApp.soundscape.musicSlots.some((slot) => slot.source.playing),
      );
      assert.equal(
        await inspect(() => navigator.userActivation.hasBeenActive),
        false,
        'autoplay is verified without a real or automation-generated gesture',
      );
    }
    await page.waitForFunction(() =>
      window.audioApp.soundscape.musicSlots.some(
        (slot) => slot.name === 'music-home' && slot.source.playing && slot.source.volume > 0.2,
      ),
    );
    assert.equal(await page.evaluate(() => window.audioApp.soundscape.unlocked), false);
    await page.waitForFunction(() =>
      window.audioApp.soundscape.musicSlots.every(
        (slot) => slot.source.volume === (slot.target ? 0.28 : 0),
      ),
    );
    await page.evaluate(() => {
      window.nativeVolumeWrites = 0;
      window.steadyAudioClock = window.audioApp.soundscape.clock;
      for (const slot of window.audioApp.soundscape.musicSlots) {
        const source = slot.source;
        const volume = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(source), 'volume');
        Object.defineProperty(source, 'volume', {
          configurable: true,
          get() {
            return volume.get.call(this);
          },
          set(value) {
            window.nativeVolumeWrites++;
            volume.set.call(this, value);
          },
        });
      }
    });
    await page.waitForFunction(
      () => window.audioApp.soundscape.clock > window.steadyAudioClock + 1,
    );
    assert.equal(
      await page.evaluate(() => window.nativeVolumeWrites),
      0,
      'steady background music must not continually write the native audio volume',
    );
    await page.evaluate(() => {
      for (const slot of window.audioApp.soundscape.musicSlots) delete slot.source.volume;
    });
    assert(
      await page.evaluate(() =>
        window.audioApp.soundscape.effects.every((source) => !source.playing),
      ),
      'startup only plays background music',
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
    await page.evaluate(() => {
      window.interruptedMusic = window.audioApp.soundscape.musicSlots.find(
        (slot) => slot.target === 1,
      ).source;
      window.musicResumes = 0;
      window.interruptedMusic.node.on(
        window.interruptedMusic.constructor.EventType.STARTED,
        () => window.musicResumes++,
      );
      window.interruptedMusic.currentTime = 5;
      window.interruptedMusic.pause();
    });
    await page.waitForFunction(
      () => window.interruptedMusic.playing && window.musicResumes === 1,
      null,
      { timeout: 5000 },
    );
    assert.ok(
      await page.evaluate(() => window.interruptedMusic.currentTime >= 5),
      'pause recovery must continue at the existing position',
    );
    await page.evaluate(() => window.interruptedMusic.stop());
    await page.waitForFunction(
      () => window.interruptedMusic.playing && window.musicResumes === 2,
      null,
      { timeout: 5000 },
    );
    await page.waitForFunction(() => window.interruptedMusic.currentTime > 0.5, null, {
      timeout: 5000,
    });
    assert.equal(
      await page.evaluate(() => window.musicResumes),
      2,
      'healthy background music must not restart repeatedly',
    );
    await page.evaluate(() => {
      const source = window.interruptedMusic;
      source.currentTime = 8;
      window.stalledAudioPlayer = source._player;
      // Simulate a native play request that never reports onPlay or an error.
      window.stalledAudioPlayer.play = () => new Promise(() => {});
      source.pause();
    });
    await page.waitForFunction(
      () =>
        window.interruptedMusic.playing &&
        window.musicResumes === 3 &&
        window.interruptedMusic._player !== window.stalledAudioPlayer,
      null,
      { timeout: 10000 },
    );
    assert.ok(
      await page.evaluate(() => window.interruptedMusic.currentTime >= 8),
      'stalled-player fallback preserves the music position',
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
    const mutedPage = await browser.newPage();
    try {
      mutedPage.on('pageerror', (error) => errors.push(error.message));
      await mutedPage.addInitScript(() => {
        localStorage.setItem('star-isle-v1', JSON.stringify({ sound: false }));
        // Hold login so that stored mute is tested before cloud assets arrive.
        window.wx = {
          getDeviceInfo: () => ({ platform: 'devtools' }),
          getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
          login: () => {},
          request: (options) => options.fail(),
        };
      });
      await mutedPage.goto(`${origin}/?qa=muted-startup`, { waitUntil: 'networkidle' });
      await mutedPage.waitForFunction(() => {
        const app = window.cc?.director
          ?.getScene()
          ?.getChildByName('StarIsleGame')
          ?.getComponent('StarIsle');
        return app?.onlineReady && app.soundscape.loadedCount === 22;
      });
      assert(
        await mutedPage.evaluate(() => {
          const app = cc.director
            .getScene()
            .getChildByName('StarIsleGame')
            .getComponent('StarIsle');
          return (
            !app.practice &&
            !app.save.sound &&
            app.soundscape.musicSlots.every((slot) => !slot.source.playing && slot.target === 0)
          );
        }),
        'saved mute remains effective while WeChat login and asset loading are pending',
      );
    } finally {
      await mutedPage.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.resolve(
        __dirname,
        `../output/qa-audio/result-${autoplayBlocked ? 'blocked' : 'allowed'}.json`,
      ),
      JSON.stringify(
        {
          success: true,
          checks: [
            '22 clips loaded',
            autoplayBlocked ? 'browser gesture fallback' : 'home music without interaction',
            'home/game music',
            'voice ducking and recovery',
            'steady music and inactive channels stop writing native volume',
            'unexpected pause/stop resumes the same music source without repeatedly restarting',
            'missing native playback acknowledgement recovers through one player reset',
            'leaf match effects',
            'mute stops all channels',
            'background stops sound and foreground resumes game music',
            'unmute and home transition',
            'saved mute before WeChat login finishes',
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS — ${autoplayBlocked ? 'browser gesture fallback' : 'startup autoplay'}, speech ducking, music transitions, saved mute and leaf effects.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
