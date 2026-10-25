const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/ApiEnvironment.ts');
assert(fs.existsSync(file), 'The runtime API environment resolver must exist');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { detectApiEnvironment, resolveApiConfiguration, normalizeApiBaseUrl } = mod.exports;
const config = {
  environments: {
    local: { apiBaseUrl: 'http://127.0.0.1:8080/api/v1/' },
    preview: { apiBaseUrl: 'https://preview.example.com/api/v1/' },
    production: { apiBaseUrl: 'https://production.example.com/api/v1/' },
  },
};
const runtime = (platform, envVersion) => ({
  getDeviceInfo: () => ({ platform }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
});
assert.equal(
  normalizeApiBaseUrl('http://dev_api.local:8080/api/v1', 'local'),
  'http://dev_api.local:8080/api/v1',
);
assert.equal(
  normalizeApiBaseUrl('http://[0:0:0:0:0:0:0:1]:8080/api/v1', 'local'),
  'http://[::1]:8080/api/v1',
);
assert.equal(
  normalizeApiBaseUrl('https://[2001:0db8:0:0:0:0:0:1]/api/v1', 'production'),
  'https://[2001:db8::1]/api/v1',
);
for (const [platform, version, expected] of [
  ['devtools', 'develop', 'local'],
  ['devtools', 'release', 'local'],
  ['ios', 'develop', 'local'],
  ['android', 'trial', 'preview'],
  ['ios', 'release', 'production'],
  ['windows', 'release', 'production'],
  ['ohos', 'trial', 'preview'],
  ['ios', 'unknown', 'production'],
]) {
  assert.equal(detectApiEnvironment(runtime(platform, version)), expected);
  assert.deepEqual(resolveApiConfiguration(config, runtime(platform, version)), {
    environment: expected,
    apiBaseUrl: config.environments[expected].apiBaseUrl.slice(0, -1),
  });
}
assert.equal(detectApiEnvironment(), 'local');
assert.equal(detectApiEnvironment({}), 'production');
assert.equal(
  detectApiEnvironment({
    getDeviceInfo: () => {
      throw Error('old SDK');
    },
    getSystemInfoSync: () => ({ platform: 'devtools' }),
  }),
  'local',
);
assert.equal(
  detectApiEnvironment({
    getDeviceInfo: () => ({}),
    getSystemInfoSync: () => ({ platform: 'devtools' }),
  }),
  'local',
);
assert.equal(
  detectApiEnvironment({
    getSystemInfoSync: () => {
      throw Error('device unavailable');
    },
    getAccountInfoSync: () => {
      throw Error('account unavailable');
    },
  }),
  'production',
);
assert.equal(
  resolveApiConfiguration(
    { apiBaseUrl: 'https://legacy.example.com/api/v1/' },
    runtime('ios', 'release'),
  ).apiBaseUrl,
  'https://legacy.example.com/api/v1',
);
assert.throws(
  () =>
    resolveApiConfiguration(
      { apiBaseUrl: 'http://127.0.0.1:8080/api/v1' },
      runtime('ios', 'release'),
    ),
  /HTTPS|本机/,
);
assert.throws(
  () =>
    resolveApiConfiguration(
      {
        apiBaseUrl: 'https://legacy.example.com',
        environments: { local: config.environments.local },
      },
      runtime('ios', 'release'),
    ),
  /production|配置/,
);
for (const invalid of [
  'http://remote.example.com/api/v1',
  'https://localhost/api/v1',
  'https://127.0.0.1/api/v1',
  'https://a:b@example.com/api/v1',
  'https://example.com/api/v1?token=1',
  'https://example.com/api/v1#x',
  'javascript:alert(1)',
  '/api/v1',
  'https://127.1/api/v1',
  'https://2130706433/api/v1',
  'https://0x7f000001/api/v1',
  'https://[0:0:0:0:0:0:0:1]/api/v1',
  'https://[::ffff:127.0.0.1]/api/v1',
  'https://[::::]/api/v1',
  'https://example..com/api/v1',
]) {
  assert.throws(
    () =>
      resolveApiConfiguration(
        { environments: { ...config.environments, production: { apiBaseUrl: invalid } } },
        runtime('ios', 'release'),
      ),
    undefined,
    invalid,
  );
}
const actual = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../assets/resources/online.json'), 'utf8'),
);
assert.equal(
  resolveApiConfiguration(actual, runtime('devtools', 'develop')).apiBaseUrl,
  'http://127.0.0.1:8080/api/v1',
);
assert.equal(
  resolveApiConfiguration(actual, runtime('ios', 'develop')).apiBaseUrl,
  'http://127.0.0.1:8080/api/v1',
);
assert.equal(
  resolveApiConfiguration(actual, runtime('ios', 'release')).apiBaseUrl,
  'https://hp.autora.cn/api/v1',
);
console.log('PASS — local, preview, release, SDK fallbacks and API configuration validation.');
