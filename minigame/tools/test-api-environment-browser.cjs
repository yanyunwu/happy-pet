const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '../build/web-mobile');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
};
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = path.resolve(
    root,
    '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname),
  );
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(response);
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const results = [],
    errors = [],
    external = [];
  try {
    for (const spec of [
      { name: 'browser', expected: 'local' },
      { name: 'devtools', platform: 'devtools', version: 'develop', expected: 'local' },
      { name: 'phone development', platform: 'ios', version: 'develop', expected: 'local' },
      { name: 'phone trial', platform: 'android', version: 'trial', expected: 'preview' },
      { name: 'phone release', platform: 'ios', version: 'release', expected: 'production' },
      {
        name: 'devtools release simulation',
        platform: 'devtools',
        version: 'release',
        expected: 'local',
      },
      { name: 'older devtools SDK', platform: 'devtools', legacy: true, expected: 'local' },
      { name: 'unknown native SDK', platform: 'ios', expected: 'production' },
    ]) {
      const context = await browser.newContext({ viewport: { width: 432, height: 936 } });
      try {
        await context.route('**/*', (route) => {
          if (new URL(route.request().url()).origin !== origin) {
            external.push(route.request().url());
            return route.abort();
          }
          return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(spec.name + ': ' + error.message));
        await page.addInitScript((spec) => {
          window.environmentRequests = [];
          if (spec.name === 'browser') return;
          window.wx = {
            getDeviceInfo: spec.legacy ? undefined : () => ({ platform: spec.platform }),
            getSystemInfoSync: () => ({ platform: spec.platform }),
            getAccountInfoSync: () => ({ miniProgram: { envVersion: spec.version } }),
            login: (options) => options.success({ code: 'environment-probe-only' }),
            request: (options) => {
              window.environmentRequests.push(options.url);
              options.fail();
            },
          };
        }, spec);
        await page.goto(origin, { waitUntil: 'networkidle' });
        await page.waitForFunction(
          () =>
            window.cc?.director
              ?.getScene()
              ?.getChildByName('StarIsleGame')
              ?.getComponent('StarIsle')?.onlineReady,
        );
        const selected = await page.evaluate(() => {
          const app = cc.director
            .getScene()
            .getChildByName('StarIsleGame')
            .getComponent('StarIsle');
          return {
            environment: app.apiEnvironment,
            url: app.online?.baseURL,
            calls: window.environmentRequests,
          };
        });
        const expectedURL =
          spec.expected === 'local'
            ? 'http://127.0.0.1:8080/api/v1'
            : 'https://hp.autora.cn/api/v1';
        assert.equal(selected.environment, spec.expected, spec.name);
        assert.equal(selected.url, expectedURL, spec.name);
        if (spec.name === 'browser') assert.deepEqual(selected.calls, []);
        else assert.deepEqual(selected.calls, [expectedURL + '/auth/wechat']);
        results.push({ name: spec.name, ...selected });
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], 'environment probes must not contact real APIs');
    const output = path.resolve(__dirname, '../output/qa-api-environments');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ success: true, results, errors, external }, null, 2),
    );
    console.log(
      'PASS — 8 exported-Cocos environment scenarios; every login URL matched, no live API requests.',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
