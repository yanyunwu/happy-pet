// Real UI regression: wooden inset bounds, modal transitions and click blocking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const output = path.resolve(__dirname, '../output/qa-modals');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({
    viewport: { width: 432, height: 936 },
    deviceScaleFactor: 2,
  });
  const failures = [],
    errors = [],
    checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const click = (x, y) => page.mouse.click(x * 0.6, y * 0.6);
  const settled = () =>
    page.waitForFunction(() => {
      const m = window.modalApp.modal,
        o = m?.getComponent('cc.UIOpacity');
      return !m || (Math.abs(m.scale.x - 1) < 0.001 && (!o || o.opacity === 255));
    });
  const opening = async (name) => {
    await page.waitForFunction((name) => window.modalApp.modal?.name === name, name);
    const state = await page.evaluate(() => {
      const a = window.modalApp,
        m = a.modal,
        o = m.getComponent('cc.UIOpacity'),
        shade = m.getChildByName('Backdrop');
      const t = shade._uiProps.uiTransformComp,
        origin = a.stage.worldPosition,
        p = shade.worldPosition;
      return {
        scale: m.scale.x,
        alpha: o?.opacity ?? 255,
        width: t.width * shade.worldScale.x,
        height: t.height * shade.worldScale.y,
        x: p.x - origin.x,
        y: p.y - origin.y,
      };
    });
    if (Math.abs(state.scale - 1) < 0.001 && state.alpha === 255)
      failures.push(`${name}: no opening animation`);
    if (
      Math.abs(state.width - 720) > 0.01 ||
      Math.abs(state.height - 1560) > 0.01 ||
      Math.abs(state.x - 360) > 0.01 ||
      Math.abs(state.y + 780) > 0.01
    )
      failures.push(`${name}: backdrop does not cover the screen during entry`);
    await settled();
  };
  const bounds = async (name, children, panelName = 'Panel') => {
    const report = await page.evaluate(
      ({ children, panelName }) => {
        const m = window.modalApp.modal;
        const rect = (n) => {
          const t = n._uiProps.uiTransformComp;
          return {
            left: n.position.x - t.width / 2,
            right: n.position.x + t.width / 2,
            top: -n.position.y - t.height / 2,
            bottom: -n.position.y + t.height / 2,
          };
        };
        return {
          panel: rect(m.getChildByName(panelName)),
          children: children.map((name) => ({ name, ...rect(m.getChildByName(name)) })),
        };
      },
      { children, panelName },
    );
    for (const r of report.children)
      if (
        r.left < report.panel.left + 43 ||
        r.right > report.panel.right - 43 ||
        r.top < report.panel.top + 43 ||
        r.bottom > report.panel.bottom - 43
      )
        failures.push(`${name}/${r.name}: outside panel inset`);
    checks.push(`${name}: content bounds checked`);
  };
  const close = async () => {
    const before = await page.evaluate(() => {
      const m = window.modalApp.modal,
        n = m.getChildByName('Close');
      return { name: m.name, x: n.position.x, y: -n.position.y };
    });
    await click(before.x, before.y);
    if (!(await page.evaluate((name) => window.modalApp.modal?.name === name, before.name)))
      failures.push(`${before.name}: closes without exit animation`);
    await page.waitForFunction(() => !window.modalApp.modal);
  };
  try {
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate(
      () =>
        (window.modalApp = cc.director
          .getScene()
          .getChildByName('StarIsleGame')
          .getComponent('StarIsle')),
    );
    await click(610, 1036);
    await opening('Settings');
    await bounds('Settings', ['Banner', 'SoundToggle', 'SettingsDone']);
    const closeGlyph = await page.evaluate(
      () =>
        window.modalApp.modal
          .getChildByName('Close')
          .children.find((n) => n.getComponent('cc.Label'))
          .getComponent('cc.Label').fontSize,
    );
    if (closeGlyph < 44) failures.push('Settings: close glyph is still too small');
    await page.screenshot({ path: path.join(output, 'settings.png') });
    await close();
    await click(56, 75);
    await opening('HomeMenu');
    await bounds('HomeMenu', ['SystemSettings', 'CustomerService', 'Announcements'], 'MenuPanel');
    await page.screenshot({ path: path.join(output, 'menu.png') });
    await click(199, 200);
    await opening('Settings');
    await page.waitForTimeout(190);
    assert.equal(
      await page.evaluate(() => window.modalApp.modal?.name),
      'Settings',
      'old exit callback must not clear the replacement dialog',
    );
    const count = await page.evaluate(
      () =>
        window.modalApp.stage.children.filter(
          (n) => n.active && ['HomeMenu', 'Settings'].includes(n.name),
        ).length,
    );
    assert.equal(count, 1, 'replacement removes the previous overlay');
    await close();
    await click(277, 1036);
    await opening('Album');
    await bounds('Album', ['Banner', 'AlbumDone']);
    if (await page.evaluate(() => !!window.modalApp.modal.getChildByName('Subtitle')))
      failures.push('Album: redundant zodiac subtitle remains');
    await page.screenshot({ path: path.join(output, 'album.png') });
    await close();
    await click(535, 1400);
    await opening('Campaign');
    await bounds('Campaign', ['Banner', 'Campaign-classic', 'Campaign-quartet', 'Campaign-fun']);
    await page.screenshot({ path: path.join(output, 'campaign.png') });
    await close();
    await click(185, 1220);
    await opening('Rules');
    const target = await page.evaluate(() => {
      const a = window.modalApp,
        id = a.game.availableTiles()[0].id,
        n = a.tileNodes.get(id);
      return { x: n.position.x, y: -n.position.y, moves: a.game.moves };
    });
    await click(360, 1203);
    if (!(await page.evaluate(() => window.modalApp.modal?.name === 'Rules')))
      failures.push('Rules: close mask disappears immediately');
    await click(target.x, target.y);
    const duringClose = await page.evaluate(() => window.modalApp.game.moves);
    if (duringClose !== target.moves)
      failures.push('Rules: click passes through closing overlay into board');
    await page.waitForFunction(() => !window.modalApp.modal);
    await click(664, 77);
    await opening('Pause');
    await click(360, 1070);
    if ((await page.evaluate(() => window.modalApp.currentScreen)) !== 'game')
      failures.push('Pause: navigation skips exit animation');
    await page.waitForFunction(
      () => window.modalApp.currentScreen === 'home' && !window.modalApp.modal,
    );
    await page.evaluate(() => {
      window.modalApp.showSettings();
      window.modalApp.startLevel(1);
      window.modalApp.clearScreen('home');
    });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.modalApp.currentScreen), 'home');
    assert.equal(
      await page.evaluate(() => window.modalApp.modal?.name || ''),
      '',
      'forced screen cleanup cancels pending modal callbacks',
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ success: !failures.length, checks, failures, errors }, null, 2),
    );
    assert.deepEqual(failures, []);
    console.log(
      'PASS — inset alignment, larger close control, album copy, entry/exit animation, replacement, close-mask blocking and cancelled navigation callbacks.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
