// Inspect real Creator sprite meshes: horizontal artwork must not collapse its
// middle rows, and protected corners must scale equally on both axes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const output = path.resolve(__dirname, '../output/qa-skins');
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
  const errors = [],
    samples = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const click = async (x, y) => {
    await page.mouse.click(x * 0.6, y * 0.6);
    await page.waitForFunction(() => {
      const app = window.skinApp,
        m = app?.modal,
        opacity = m?.getComponent('cc.UIOpacity');
      const closing = Array.from(app?.modals?.motions || []).some(
        (state) => state.node === m && state.closing,
      );
      return (
        !m || (!closing && Math.abs(m.scale.x - 1) < 0.001 && (!opacity || opacity.opacity === 255))
      );
    });
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
    await page.evaluate(() => {
      window.skinApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      window.readSkinMesh = (root, path) => {
        const host = path.split('/').reduce((node, name) => node.getChildByName(name), root);
        const find = (node) =>
          node.getComponent('cc.Sprite') || node.children.map(find).find(Boolean);
        const sprite = find(host),
          frame = sprite.spriteFrame,
          data = sprite.renderData.data;
        const sourceHeight = frame.originalSize.height;
        const worldScale = sprite.node.worldScale;
        const hostSize = host._uiProps.uiTransformComp.contentSize;
        const drawSize = sprite.node._uiProps.uiTransformComp.contentSize;
        const sourceRows = [
          frame.insetBottom,
          sourceHeight - frame.insetBottom - frame.insetTop,
          frame.insetTop,
        ];
        const targetRows =
          data.length === 16
            ? [data[4].y - data[0].y, data[8].y - data[4].y, data[12].y - data[8].y]
            : [];
        return {
          name: `${root.name}/${path}`,
          hostSize: [hostSize.width * host.worldScale.x, hostSize.height * host.worldScale.y],
          drawSize: [drawSize.width * worldScale.x, drawSize.height * worldScale.y],
          verticalScales: targetRows.map((height, i) => (height * worldScale.y) / sourceRows[i]),
          leftScale:
            data.length === 16 ? ((data[1].x - data[0].x) * worldScale.x) / frame.insetLeft : null,
        };
      };
    });
    const sample = async (root, names) => {
      await page.waitForTimeout(180);
      samples.push(
        ...(await page.evaluate(
          ({ root, names }) =>
            names.map((name) =>
              window.readSkinMesh(
                root === 'home' ? window.skinApp.homeRoot : window.skinApp.modal,
                name,
              ),
            ),
          { root, names },
        )),
      );
    };
    await sample('home', [
      'Shortcuts/SignInButton/Nameplate',
      'Shortcuts/AlbumButton/Nameplate',
      'Shortcuts/BagButton/Nameplate',
      'Shortcuts/GameClubButton/Nameplate',
      'WelcomePanel/Mode-classic',
      'WelcomePanel/Mode-quartet',
      'WelcomePanel/Mode-fun',
      'WelcomePanel/CampaignButton',
      'TopBar/CoinCounter',
    ]);
    await page.screenshot({ path: path.join(output, 'home.png') });
    await page.screenshot({
      path: path.join(output, 'home-labels.png'),
      clip: { x: 12, y: 570, width: 408, height: 103 },
    });
    await click(56, 75);
    await page.waitForFunction(() => window.skinApp.modal?.name === 'HomeMenu');
    await sample('modal', [
      'PersonalSettings',
      'SystemSettings',
      'CustomerService',
      'Announcements',
    ]);
    await page.screenshot({ path: path.join(output, 'menu.png') });
    await page.screenshot({
      path: path.join(output, 'menu-detail.png'),
      clip: { x: 21, y: 64, width: 200, height: 273 },
    });
    await click(199, 283);
    await page.waitForFunction(() => window.skinApp.modal?.name === 'Settings');
    await sample('modal', ['Banner', 'SoundToggle', 'SettingsDone']);
    const close = await page.evaluate(() => {
      const n = window.skinApp.modal.getChildByName('Close');
      return { x: n.position.x, y: -n.position.y };
    });
    await click(close.x, close.y);
    await page.waitForFunction(() => !window.skinApp.modal);
    const signIn = await page.evaluate(() => {
      const n = window.skinApp.homeRoot.getChildByName('Shortcuts').getChildByName('SignInButton');
      return { x: n.position.x, y: -n.position.y };
    });
    await click(signIn.x, signIn.y);
    await page.waitForFunction(() => window.skinApp.modal?.name === 'SignIn');
    await sample('modal', ['Banner', 'ClaimSignIn']);
    await page.screenshot({ path: path.join(output, 'signin.png') });
    await page.screenshot({
      path: path.join(output, 'signin-header.png'),
      clip: { x: 18, y: 128, width: 396, height: 85 },
    });
    const failures = samples.flatMap((sample) => {
      const ratios = sample.verticalScales;
      if (ratios.length !== 3 || ratios.some((v) => !Number.isFinite(v) || v <= 0))
        return [`${sample.name}: collapsed texture row ${ratios}`];
      if (Math.max(...ratios) - Math.min(...ratios) > 0.001)
        return [`${sample.name}: non-uniform vertical scaling ${ratios}`];
      if (Math.abs(sample.leftScale - ratios[0]) > 0.001)
        return [`${sample.name}: corner aspect changed`];
      if (sample.drawSize.some((v, i) => Math.abs(v - sample.hostSize[i]) > 0.01))
        return [`${sample.name}: artwork no longer matches hit area`];
      return [];
    });
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify(
        { success: !failures.length && !errors.length, samples, failures, errors },
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      failures,
      [],
      'Wooden bars must preserve their source height and corner aspect ratios',
    );
    console.log(
      `PASS — ${samples.length} authored/runtime skins preserve height, corners and hit areas; menu and dialog clicks still work.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
