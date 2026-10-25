const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-pet-api-env-'));
const file = path.join(root, 'minigame/assets/resources/online.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const initial = {
  environments: {
    local: { apiBaseUrl: 'http://127.0.0.1:8080/api/v1' },
    preview: { apiBaseUrl: 'https://preview.example.com/api/v1' },
    production: { apiBaseUrl: 'https://production.example.com/api/v1' },
  },
  extra: 'keep',
};
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (values) =>
  spawnSync(process.execPath, [path.resolve(__dirname, 'configure-game.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      API_ENV: '',
      API_URL: '',
      API_LOCAL_URL: '',
      API_PREVIEW_URL: '',
      API_PRODUCTION_URL: '',
      ...values,
    },
  });
try {
  fs.writeFileSync(file, JSON.stringify(initial));
  let result = run({ API_ENV: 'preview', API_URL: 'https://preview-new.example.com/api/v1/' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(), {
    ...initial,
    environments: {
      ...initial.environments,
      preview: { apiBaseUrl: 'https://preview-new.example.com/api/v1' },
    },
  });
  result = run({
    API_LOCAL_URL: 'http://192.168.1.10:8080/api/v1',
    API_PREVIEW_URL: 'https://hp.autora.cn/api/v1',
    API_PRODUCTION_URL: 'https://hp.autora.cn/api/v1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read().environments.local.apiBaseUrl, 'http://192.168.1.10:8080/api/v1');
  assert.equal(read().environments.preview.apiBaseUrl, 'https://hp.autora.cn/api/v1');
  result = run({ API_LOCAL_URL: 'http://dev_api.local:8080/api/v1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read().environments.local.apiBaseUrl, 'http://dev_api.local:8080/api/v1');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'minigame/assets/scripts/core'), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../Makefile'), path.join(root, 'Makefile'));
  fs.copyFileSync(
    path.resolve(__dirname, 'configure-game.mjs'),
    path.join(root, 'scripts/configure-game.mjs'),
  );
  fs.copyFileSync(
    path.resolve(__dirname, '../minigame/assets/scripts/core/ApiEnvironment.ts'),
    path.join(root, 'minigame/assets/scripts/core/ApiEnvironment.ts'),
  );
  const made = spawnSync(
    'make',
    ['configure-game', 'API_ENV=preview', 'API_URL=https://from-make.example.com/api/v1'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        API_ENV: '',
        API_URL: '',
        API_LOCAL_URL: '',
        API_PREVIEW_URL: '',
        API_PRODUCTION_URL: '',
      },
    },
  );
  assert.equal(made.status, 0, made.stderr);
  assert.equal(read().environments.preview.apiBaseUrl, 'https://from-make.example.com/api/v1');
  assert.equal(read().environments.local.apiBaseUrl, 'http://dev_api.local:8080/api/v1');
  result = run({ API_PREVIEW_URL: 'https://hp.autora.cn/api/v1' });
  assert.equal(result.status, 0, result.stderr);
  result = run({ API_URL: 'https://release-next.example.com/api/v1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    read().environments.production.apiBaseUrl,
    'https://release-next.example.com/api/v1',
  );
  assert.equal(read().environments.preview.apiBaseUrl, 'https://hp.autora.cn/api/v1');
  for (const invalid of [
    {},
    { API_ENV: 'unknown', API_URL: 'https://example.com/api/v1' },
    { API_PRODUCTION_URL: 'http://127.0.0.1:8080/api/v1' },
    { API_PREVIEW_URL: 'http://example.com/api/v1' },
    { API_PRODUCTION_URL: 'https://localhost/api/v1' },
    { API_PRODUCTION_URL: 'https://user:pass@example.com/api/v1' },
    { API_PRODUCTION_URL: 'https://example.com/api/v1?q=1' },
    { API_PRODUCTION_URL: 'https://example.com/api/v1#test' },
    { API_PRODUCTION_URL: 'https://example.com/api/v1?' },
    { API_PRODUCTION_URL: 'https://example.com/api/v1#' },
    { API_PRODUCTION_URL: 'https://example.com:0/api/v1' },
    { API_PRODUCTION_URL: 'https://127.1/api/v1' },
    { API_PRODUCTION_URL: 'https://[0:0:0:0:0:0:0:1]/api/v1' },
    { API_PRODUCTION_URL: 'https://[::::]/api/v1' },
    {
      API_ENV: 'preview',
      API_URL: 'https://a.example.com/api/v1',
      API_PREVIEW_URL: 'https://b.example.com/api/v1',
    },
  ]) {
    const before = fs.readFileSync(file, 'utf8');
    result = run(invalid);
    assert.notEqual(result.status, 0, JSON.stringify(invalid));
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      before,
      'invalid input must not partially replace configuration',
    );
  }
  fs.writeFileSync(file, JSON.stringify({ apiBaseUrl: 'http://127.0.0.1:8080/api/v1' }));
  result = run({
    API_PREVIEW_URL: 'https://hp.autora.cn/api/v1',
    API_PRODUCTION_URL: 'https://hp.autora.cn/api/v1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read().environments.local.apiBaseUrl, initial.environments.local.apiBaseUrl);
  assert.equal(read().apiBaseUrl, undefined);
  console.log(
    'PASS — per-environment configuration, preservation, validation and legacy conversion.',
  );
} finally {
  const resolved = fs.realpathSync(root);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert(path.basename(resolved).startsWith('happy-pet-api-env-'));
  fs.rmSync(resolved, { recursive: true });
}
