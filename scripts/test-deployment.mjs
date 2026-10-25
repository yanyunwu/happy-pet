// Builds and exercises only an isolated Compose project. Production env files are never read.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nonce = randomBytes(5).toString('hex');
const project = `happy-pet-check-${nonce}`;
const temporary = mkdtempSync(join(tmpdir(), 'happy-pet-deploy-'));
const composeFile = join(temporary, 'compose.json');
const envFile = join(temporary, 'test.env');
const markerFile = join(root, 'backend', `.env.container-check-${nonce}`);
const password = `Fixture-${randomBytes(18).toString('hex')}`;
const origin = 'https://deployment.example.test';
const images = Object.fromEntries(
  ['backend', 'admin', 'gateway', 'context'].map((k) => [k, `happy-pet-check/${k}:${nonce}`]),
);
const values = {
  IMAGE_PREFIX: 'crpi-ckmtqd558kzqdlu7.cn-hangzhou.personal.cr.aliyuncs.com/failure-plan',
  IMAGE_TAG: 'latest',
  POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  PGUSER: 'happy_pet_check',
  PGDATABASE: 'happy_pet_check',
  JWT_SECRET: randomBytes(40).toString('hex'),
  ADMIN_USERNAME: 'deploy-check',
  ADMIN_PASSWORD: password,
  ADMIN_ORIGIN: origin,
  WECHAT_APP_ID: 'wx5f84ab7af535815d',
  WECHAT_APP_SECRET: '',
  GATEWAY_PORT: '',
};
const environment = {
  ...process.env,
  ...values,
  MSYS_NO_PATHCONV: '1',
  COMPOSE_IGNORE_ORPHANS: 'false',
};
for (const name of [
  'COMPOSE_FILE',
  'COMPOSE_PROJECT_NAME',
  'COMPOSE_PROFILES',
  'COMPOSE_ENV_FILES',
])
  delete environment[name];
const checks = [];
let started = false;
let completed = false;
const redact = (value) =>
  [password, values.POSTGRES_PASSWORD, values.JWT_SECRET].reduce(
    (s, secret) => s.replaceAll(secret, '[redacted]'),
    value,
  );
function run(command, args, { input, allowFailure = false, timeout = 600000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let timer;
    const append = (data) => {
      out = (out + data.toString('utf8')).slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeout);
    child.on('close', (status) => {
      clearTimeout(timer);
      const result = { status, out: redact(out) };
      if (status !== 0 && !allowFailure)
        reject(
          new Error(
            `${command} ${args.slice(0, 3).join(' ')} failed:\n${result.out.slice(-16000)}`,
          ),
        );
      else resolvePromise(result);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const docker = (args, options) => run('docker', args, options);
function compose(args, options) {
  assert.match(project, /^happy-pet-check-[a-f0-9]{10}$/);
  return docker(['compose', '-p', project, '-f', composeFile, ...args], options);
}
async function startTestStack(options = {}) {
  const ready = await compose(
    [
      'up',
      '-d',
      '--no-build',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '50',
      '--remove-orphans',
      'db',
      'admin',
      'backend',
    ],
    options,
  );
  if (ready.status !== 0) return ready;
  return compose(
    [
      'up',
      '-d',
      '--no-build',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '50',
      '--remove-orphans',
      'gateway',
    ],
    options,
  );
}
async function updateTestStack(options = {}) {
  for (const args of [
    ['stop', 'gateway', 'backend'],
    ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '50', 'db', 'admin'],
    ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--force-recreate', 'backend'],
  ]) {
    const result = await compose(args, options);
    if (result.status !== 0) return result;
  }
  return startTestStack(options);
}
function dumpTestDatabase() {
  assert.match(project, /^happy-pet-check-[a-f0-9]{10}$/);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'docker',
      [
        'compose',
        '-p',
        project,
        '-f',
        composeFile,
        'exec',
        '-T',
        'db',
        'pg_dump',
        '-U',
        values.PGUSER,
        '-d',
        values.PGDATABASE,
        '-Fc',
        '--no-owner',
        '--no-privileges',
      ],
      { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks = [];
    let error = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      error += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status) =>
      status === 0 ? resolvePromise(Buffer.concat(chunks)) : reject(new Error(redact(error))),
    );
  });
}
async function sql(statement, database = values.PGDATABASE) {
  return (
    await compose(
      [
        'exec',
        '-T',
        'db',
        'psql',
        '-U',
        values.PGUSER,
        '-d',
        database,
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: statement },
    )
  ).out.trim();
}
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
async function http(base, path, status = 200, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(
    response.status,
    status,
    `${options.method || 'GET'} ${path}: ${response.status} != ${status}`,
  );
  return response;
}
const headers = (extra = {}) => ({ 'Content-Type': 'application/json', Origin: origin, ...extra });
const json = (value) => JSON.stringify(value);
function range(cidr) {
  if (!cidr || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr)) return null;
  const [address, prefix] = cidr.split('/');
  const n = address.split('.').reduce((a, b) => a * 256 + Number(b), 0),
    size = 2 ** (32 - Number(prefix)),
    start = Math.floor(n / size) * size;
  return [start, start + size - 1];
}
function playerToken(id) {
  const part = (value) => Buffer.from(json(value)).toString('base64url');
  const data =
    part({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    part({
      iss: 'happy-pet',
      sub: id,
      aud: ['miniapp'],
      ver: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  return data + '.' + createHmac('sha256', values.JWT_SECRET).update(data).digest('base64url');
}
async function address() {
  const value = (await compose(['port', 'gateway', '8080'])).out.trim();
  assert.match(value, /^127\.0\.0\.1:\d+$/);
  return `http://${value}`;
}

try {
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(
    join(root, 'artifacts/deployment-qa.json'),
    JSON.stringify({ ok: false, startedAt: new Date().toISOString(), checks: [] }, null, 2),
  );
  for (const path of [
    'Dockerfile',
    'Dockerfile.admin',
    'Dockerfile.gateway',
    'compose.prod.yaml',
    '.env.prod.example',
    '.dockerignore',
    'nginx.conf',
    'admin/nginx.conf',
    'SKILL.md',
  ])
    assert(existsSync(join(root, path)), path);
  writeFileSync(
    envFile,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    { mode: 0o600 },
  );
  // Capture Compose stdout separately: this JSON contains only ephemeral test secrets.
  const configured = await new Promise((resolvePromise, reject) => {
    const p = spawn(
      'docker',
      ['compose', '--env-file', envFile, '-f', 'compose.prod.yaml', 'config', '--format', 'json'],
      { cwd: root, env: environment },
    );
    let output = '',
      error = '';
    p.stdout.on('data', (d) => (output += d));
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolvePromise(JSON.parse(output)) : reject(new Error(redact(error))),
    );
  });
  assert.deepEqual(Object.keys(configured.services).sort(), ['admin', 'backend', 'db', 'gateway']);
  assert.equal(configured.services.backend.environment.PGHOST, 'db');
  assert.equal(configured.services.backend.environment.PGPASSWORD, values.POSTGRES_PASSWORD);
  assert.equal(configured.services.backend.environment.JWT_SECRET, values.JWT_SECRET);
  assert.equal(configured.services.backend.environment.COOKIE_SECURE, 'true');
  assert.equal(configured.services.backend.environment.API_TRUSTED_PROXIES, '172.30.82.2/32');
  assert.equal(configured.services.backend.environment.DATABASE_URL, undefined);
  assert.equal(configured.services.gateway.ports[0].published, '8080');
  for (const name of ['backend', 'admin', 'db'])
    assert.equal(configured.services[name].ports, undefined, `${name} must stay private`);
  for (const name of ['backend', 'admin', 'gateway']) {
    assert.equal(
      configured.services[name].build,
      undefined,
      'Production servers pull images without source builds',
    );
    assert.equal(
      configured.services[name].image,
      `${values.IMAGE_PREFIX}/happy-pet-${name}:latest`,
    );
    configured.services[name].image = images[name];
  }
  const existing = (await docker(['network', 'ls', '-q'])).out.trim().split(/\s+/).filter(Boolean);
  if (existing.length) {
    const networks = JSON.parse((await docker(['network', 'inspect', ...existing])).out);
    const wanted = range('172.30.82.0/24');
    assert(
      !networks.some((n) =>
        n.IPAM?.Config?.some((c) => {
          const r = range(c.Subnet);
          return r && r[0] <= wanted[1] && wanted[0] <= r[1];
        }),
      ),
      '172.30.82.0/24 is already in use. Run tests on an isolated development/CI Docker host.',
    );
  }
  configured.name = project;
  configured.services.gateway.ports = [
    { target: 8080, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' },
  ];
  for (const service of Object.values(configured.services)) service.restart = 'no';
  for (const value of Object.values(configured.networks)) {
    assert(!value.external);
    delete value.name;
  }
  for (const value of Object.values(configured.volumes)) {
    assert(!value.external);
    delete value.name;
  }
  assert(configured.volumes.postgres, 'Preserve the existing production volume key');
  writeFileSync(composeFile, json(configured), { mode: 0o600 });
  checks.push(
    'four-service production topology, private database/API, existing volume name and isolated test credentials',
  );

  for (const [name, file] of [
    ['backend', 'Dockerfile'],
    ['admin', 'Dockerfile.admin'],
    ['gateway', 'Dockerfile.gateway'],
  ]) {
    console.log(`构建并检查 ${name} 镜像…`);
    await docker(['build', '--progress=plain', '-f', file, '-t', images[name], '.']);
    const image = JSON.parse((await docker(['image', 'inspect', images[name]])).out)[0];
    assert(image.Config.User && !['root', '0', '0:0'].includes(image.Config.User));
    assert(image.Config.Healthcheck?.Test?.length);
  }
  writeFileSync(markerFile, 'synthetic-secret-marker');
  await docker(['build', '-f', '-', '-t', images.context, '.'], {
    input: 'FROM scratch\nCOPY backend/go.mod /probe\n',
  });
  const excluded = await docker(['build', '--no-cache', '-f', '-', '.'], {
    input: `FROM scratch\nCOPY backend/${markerFile.split(/[\\/]/).at(-1)} /probe\n`,
    allowFailure: true,
  });
  assert.notEqual(excluded.status, 0);
  assert.match(excluded.out, /not found|excluded|does not exist/i);
  checks.push(
    'all application images non-root and health checked; environment files excluded from build context',
  );

  console.log('验证空库初始化和失败回滚…');
  started = true;
  await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'db']);
  const failed = await compose(
    ['run', '--rm', '--no-deps', '-e', 'ADMIN_USERNAME=', '-e', 'ADMIN_PASSWORD=', 'backend'],
    { allowFailure: true },
  );
  assert.notEqual(failed.status, 0);
  assert.match(failed.out, /首次初始化/);
  assert.equal(
    await sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"),
    '0',
  );
  await startTestStack();
  let base = await address();
  const versions = readdirSync(join(root, 'backend/sql/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort();
  assert.equal(
    await sql("SELECT string_agg(version::text,',' ORDER BY version) FROM schema_migrations"),
    versions.map((n) => parseInt(n, 10)).join(','),
  );
  assert.equal(await sql('SELECT count(*) FROM admin_accounts'), '1');
  assert.equal(await sql('SELECT count(*) FROM users'), '0');
  checks.push('bootstrap failure rolls back all DDL; normal startup migrates and seeds once');

  console.log('验证 SPA、缓存、认证与代理边界…');
  assert.equal((await http(base, '/', 308)).headers.get('location'), '/admin/');
  assert.equal((await http(base, '/admin', 308)).headers.get('location'), '/admin/');
  await http(base, '/api/health');
  await http(base, '/healthz');
  const skill = await http(base, '/admin/SKILL.md');
  assert.match(skill.headers.get('content-type'), /^text\/markdown;\s*charset=utf-8$/i);
  assert.equal(skill.headers.get('x-content-type-options'), 'nosniff');
  assert.match(skill.headers.get('cache-control'), /no-cache/);
  assert.equal(await skill.text(), readFileSync(join(root, 'SKILL.md'), 'utf8'));
  const openapi = await (await http(base, '/api/v1/openapi.json')).json();
  assert.match(openapi.openapi, /^3\./);
  assert.ok(openapi.paths['/api/v1/admin/auth/access-token']?.put);
  assert.ok(openapi.paths['/api/v1/user/sessions/{id}/events']?.post);
  await http(base, '/unknown', 404);
  await http(base, '/api/v1/admin/users', 401);
  const page = await http(base, '/admin/levels');
  assert.match(page.headers.get('cache-control'), /no-cache/);
  const html = await page.text();
  assert(html.includes('快乐萌宠消'));
  const asset = html.match(/src="(\/admin\/assets\/[^" ]+\.js)"/);
  assert(asset);
  const staticFile = await http(base, asset[1]);
  assert.match(staticFile.headers.get('cache-control'), /immutable/);
  assert.equal(staticFile.headers.get('x-content-type-options'), 'nosniff');
  await http(base, '/admin/assets/missing.js', 404);
  await http(base, '/admin/pets/missing.png', 404);
  await http(base, '/admin/pets/0.png');
  const credentials = json({ username: values.ADMIN_USERNAME, password });
  await http(base, '/api/v1/admin/auth/login', 403, {
    method: 'POST',
    headers: headers({ Origin: 'https://untrusted.example' }),
    body: credentials,
  });
  const login = await http(base, '/api/v1/admin/auth/login', 200, {
    method: 'POST',
    headers: headers(),
    body: credentials,
  });
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookie = setCookie.split(';')[0];
  await http(base, '/api/v1/admin/users', 200, { headers: { Cookie: cookie } });
  await http(base, '/api/v1/admin/auth/logout', 403, {
    method: 'POST',
    headers: headers({ Cookie: cookie, Origin: 'https://untrusted.example' }),
  });
  const levels = await (
    await http(base, '/api/v1/admin/levels', 200, { headers: { Cookie: cookie } })
  ).json();
  assert.equal(levels.length, 12);
  assert.equal(levels.filter((level) => level.entry === 'standard').length, 6);
  assert.equal(levels.filter((level) => level.entry === 'campaign').length, 6);
  const probeCode = json({ code: 'no-wechat-secret-in-fixture' });
  for (let i = 1; i <= 31; i++)
    await http(base, '/api/v1/auth/wechat', 503, {
      method: 'POST',
      headers: headers({ 'X-Forwarded-For': `203.0.113.${i}`, 'X-Forwarded-Proto': 'https' }),
      body: probeCode,
    });
  const forged = await compose([
    'exec',
    '-T',
    'backend',
    'sh',
    '-c',
    `i=1; while [ "$i" -le 31 ]; do curl --silent --output /dev/null --write-out '%{http_code} ' -H 'Content-Type: application/json' -H "X-Forwarded-For: 198.51.100.$i" --data '${probeCode}' http://gateway:8080/api/v1/auth/wechat; i=$((i+1)); done`,
  ]);
  assert.deepEqual(forged.out.trim().split(/\s+/), [...Array(30).fill('503'), '429']);
  checks.push(
    'SPA deep links and cache headers; Secure/HttpOnly cookies; CSRF; trusted proxy client IPs and forged-IP rate limit',
  );

  const player = randomBytes(16).toString('hex');
  await sql(
    `INSERT INTO users(id,wechat_openid,nickname) VALUES(${quote(player)},'qa-player','部署验证玩家'); INSERT INTO player_assets(user_id,coins,undo,shovel,hint,shuffle) VALUES(${quote(player)},137,2,3,4,5);`,
  );
  const tokenResult = await (
    await http(base, '/api/v1/admin/auth/access-token', 200, {
      method: 'PUT',
      headers: headers({ Cookie: cookie }),
      body: '{}',
    })
  ).json();
  assert.ok(typeof tokenResult.accessToken === 'string' && tokenResult.accessToken.length >= 32);
  const tokenHeaders = { Authorization: `Bearer ${tokenResult.accessToken}` };
  await http(base, '/api/v1/admin/accounts', 200, { headers: tokenHeaders });
  await http(base, '/api/v1/admin/settings', 200, { headers: tokenHeaders });
  await http(base, '/api/v1/admin/users', 401, {
    headers: { Cookie: cookie, Authorization: 'Bearer invalid-explicit-token' },
  });
  const impersonatedAssets = await (
    await http(base, '/api/v1/user/assets', 200, {
      headers: { ...tokenHeaders, 'X-User-ID': player },
    })
  ).json();
  assert.equal(impersonatedAssets.coins, 137);
  await http(base, '/api/v1/admin/auth/access-token', 204, {
    method: 'DELETE',
    headers: headers({ Cookie: cookie }),
  });
  await http(base, '/api/v1/admin/accounts', 401, { headers: tokenHeaders });
  checks.push(
    'gateway serves exact SKILL Markdown and OpenAPI; admin token reaches admin/player APIs and revokes immediately',
  );
  const bearer = playerToken(player);
  const playerHeaders = headers({ Authorization: `Bearer ${bearer}` });
  const session = await (
    await http(base, '/api/v1/user/sessions', 200, {
      method: 'POST',
      headers: playerHeaders,
      body: json({ mode: 'classic', requestId: 'deployment-fixture-session' }),
    })
  ).json();
  const tile = session.state.tiles.find(
    (t) =>
      !session.state.tiles.some(
        (o) => o.layer > t.layer && Math.abs(o.x - t.x) < 90 && Math.abs(o.y - t.y) < 94,
      ),
  );
  assert(tile);
  await http(base, `/api/v1/user/sessions/${session.id}/events`, 200, {
    method: 'POST',
    headers: playerHeaders,
    body: json({ events: [{ seq: 1, type: 'pick', tileId: tile.id, at: 10 }] }),
  });
  const beforeReplay = await (
    await http(base, `/api/v1/admin/sessions/${session.id}/replay`, 200, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(beforeReplay.events.length, 1);
  const preservedHash = await sql('SELECT password_hash FROM admin_accounts');

  console.log('验证已有首次部署基线重复启动时保留数据…');
  const retained = 'happy_pet_existing_baseline';
  await sql(`CREATE DATABASE ${retained}`);
  await compose([
    'exec',
    '-T',
    '-e',
    `PGDATABASE=${retained}`,
    'backend',
    'happy-pet-api',
    '-migrate-only',
  ]);
  const previousHash = await sql('SELECT password_hash FROM admin_accounts', retained);
  const cfg = levels.find(
    (level) => level.entry === 'campaign' && level.mode === 'classic' && level.ordinal === 1,
  ).config;
  await sql(
    `INSERT INTO users(id,wechat_openid,nickname) VALUES(${quote(player)},'qa-retained','保留玩家');
 INSERT INTO player_assets(user_id,coins,undo) VALUES(${quote(player)},42,3);
 INSERT INTO levels(id,mode,ordinal,title,draft,entry) VALUES('retained-level','classic',3,'原来的关卡',${quote(json(cfg))},'campaign');
 INSERT INTO level_revisions(id,level_id,version,config,created_by,title) VALUES('retained-revision','retained-level',1,${quote(json(cfg))},'system','原来的关卡');
 UPDATE levels SET published_revision='retained-revision',enabled=true WHERE id='retained-level';
 INSERT INTO game_sessions(id,user_id,request_key,campaign_id,level_id,revision_id,mode,ordinal,seed,initial,state,title,entry) VALUES('retained-session',${quote(player)},'retained-request','retained-session','retained-level','retained-revision','classic',3,1,${quote(json(session.state))},${quote(json(session.state))},'原来的关卡','campaign');
 INSERT INTO system_initializations(init_key) VALUES('deployment_fixture:retained');`,
    retained,
  );
  await compose([
    'exec',
    '-T',
    '-e',
    `PGDATABASE=${retained}`,
    '-e',
    'ADMIN_USERNAME=',
    '-e',
    'ADMIN_PASSWORD=',
    'backend',
    'happy-pet-api',
    '-migrate-only',
  ]);
  assert.equal(
    await sql(
      `SELECT coins||':'||undo FROM player_assets WHERE user_id=${quote(player)}`,
      retained,
    ),
    '42:3',
  );
  assert.equal(
    await sql("SELECT title FROM game_sessions WHERE id='retained-session'", retained),
    '原来的关卡',
  );
  assert.equal(await sql('SELECT password_hash FROM admin_accounts', retained), previousHash);
  assert.equal(await sql("SELECT count(*) FROM levels WHERE entry='campaign'", retained), '7');
  assert.equal(
    await sql(
      "SELECT count(*) FROM system_initializations WHERE init_key='deployment_fixture:retained'",
      retained,
    ),
    '1',
  );
  checks.push(
    'repeated baseline startup preserves passwords, assets, custom levels, replay records and generic initialization markers',
  );

  console.log('验证数据库归档和全量恢复到新的空数据库…');
  const backup = join(temporary, 'game-backup.dump');
  writeFileSync(backup, await dumpTestDatabase(), { flag: 'wx', mode: 0o600 });
  await compose(['exec', '-T', 'db', 'pg_restore', '--list'], { input: readFileSync(backup) });
  assert.equal(readFileSync(backup).subarray(0, 5).toString(), 'PGDMP');
  const restored = 'happy_pet_restored';
  await sql(`CREATE DATABASE ${restored}`);
  await compose(
    [
      'exec',
      '-T',
      'db',
      'pg_restore',
      '-U',
      values.PGUSER,
      '-d',
      restored,
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
    ],
    { input: readFileSync(backup) },
  );
  assert.equal(
    await sql(
      `SELECT coins||':'||undo||':'||shovel||':'||hint||':'||shuffle FROM player_assets WHERE user_id=${quote(player)}`,
      restored,
    ),
    '137:2:3:4:5',
  );
  assert.equal(
    await sql(`SELECT count(*) FROM game_events WHERE session_id=${quote(session.id)}`, restored),
    '1',
  );
  assert.ok((await sql('SELECT password_hash FROM admin_accounts', restored)) === preservedHash);
  checks.push('binary pg_dump archive and complete pg_restore rehearsal into a fresh database');

  console.log('验证迁移失败不开放入口，以及升级和重启后数据保留…');
  const originalChecksum = await sql('SELECT checksum FROM schema_migrations WHERE version=1');
  await sql(`UPDATE schema_migrations SET checksum=${quote('0'.repeat(64))} WHERE version=1`);
  const blockedUpdate = await updateTestStack({ allowFailure: true });
  assert.notEqual(blockedUpdate.status, 0);
  const failedLogs = await compose(['logs', '--tail=25', 'backend']);
  assert.match(
    failedLogs.out,
    /校验值|迁移/,
    'A migration failure must be the reason the new API cannot start',
  );
  assert.equal(
    (
      await docker([
        'ps',
        '-q',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--filter',
        'label=com.docker.compose.service=gateway',
      ])
    ).out.trim(),
    '',
  );
  // Restore only this deliberately corrupted test ledger, never a production ledger.
  await sql(`UPDATE schema_migrations SET checksum=${quote(originalChecksum)} WHERE version=1`);
  await startTestStack();
  base = await address();
  await updateTestStack();
  base = await address();
  const afterReplay = await (
    await http(base, `/api/v1/admin/sessions/${session.id}/replay`, 200, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.deepEqual(afterReplay.events, beforeReplay.events);
  assert.equal(await sql(`SELECT coins FROM player_assets WHERE user_id=${quote(player)}`), '137');
  await compose([
    'exec',
    '-T',
    '-e',
    'ADMIN_PASSWORD=Different-password-456',
    'backend',
    'happy-pet-api',
    '-migrate-only',
  ]);
  assert.ok((await sql('SELECT password_hash FROM admin_accounts')) === preservedHash);
  await compose(['stop']);
  assert.equal((await compose(['ps', '-q'])).out.trim(), '');
  await startTestStack();
  base = await address();
  await http(base, '/api/health');
  checks.push(
    'isolated container update, migration failure gating, password preservation, stop/start and replay persistence',
  );
  completed = true;
} finally {
  if (started) {
    const result = await compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
    assert.equal(result.status, 0, 'Unable to remove the isolated test project');
  }
  await docker(['image', 'rm', ...Object.values(images)], { allowFailure: true });
  assert(resolve(markerFile).startsWith(join(root, 'backend') + sep));
  if (existsSync(markerFile)) rmSync(markerFile);
  assert(realpathSync(temporary).startsWith(realpathSync(tmpdir()) + sep + 'happy-pet-deploy-'));
  rmSync(temporary, { recursive: true, force: true });
}
if (completed) {
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(
    join(root, 'artifacts/deployment-qa.json'),
    JSON.stringify({ ok: true, testedAt: new Date().toISOString(), checks }, null, 2),
  );
  console.log(
    `PASS — ${checks.length} deployment groups; isolated test containers, volumes and image tags removed.`,
  );
}
