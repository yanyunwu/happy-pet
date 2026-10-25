import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// Node 24 loads this pure TypeScript module directly; Cocos uses the same validator.
const { normalizeApiBaseUrl: normalize } = createRequire(import.meta.url)(
  '../minigame/assets/scripts/core/ApiEnvironment.ts',
);
const names = ['local', 'preview', 'production'];
const target = process.env.API_ENV?.trim() || 'production';
if (!names.includes(target)) throw new Error('API_ENV 必须为 local、preview 或 production');
const updates = {};
for (const name of names) {
  const value = process.env[`API_${name.toUpperCase()}_URL`]?.trim();
  if (value) updates[name] = normalize(value, name);
}
if (process.env.API_URL?.trim()) {
  const value = normalize(process.env.API_URL, target);
  if (updates[target] && updates[target] !== value)
    throw new Error(`${target} 的两项地址参数不一致`);
  updates[target] = value;
}
if (!Object.keys(updates).length)
  throw new Error(
    '请设置 API_ENV + API_URL，或 API_LOCAL_URL / API_PREVIEW_URL / API_PRODUCTION_URL',
  );
const file = path.resolve('minigame/assets/resources/online.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!config.environments) {
  const legacy = config.apiBaseUrl || 'http://127.0.0.1:8080/api/v1';
  let remote = '';
  try {
    remote = normalize(legacy, 'production');
  } catch {
    /* Require explicit phone endpoints. */
  }
  config.environments = {
    local: { apiBaseUrl: legacy },
    preview: { apiBaseUrl: remote },
    production: { apiBaseUrl: remote },
  };
}
for (const name of names) {
  const current = config.environments[name] || {};
  config.environments[name] = {
    ...current,
    apiBaseUrl: normalize(updates[name] || current.apiBaseUrl, name),
  };
}
delete config.apiBaseUrl;
const temporaryDirectory = path.resolve('minigame/temp');
fs.mkdirSync(temporaryDirectory, { recursive: true });
const temporary = path.join(temporaryDirectory, `online-config-${process.pid}.tmp`);
fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
try {
  fs.renameSync(temporary, file);
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
console.log(`已更新 ${Object.keys(updates).join('、')} 接口地址，请重新构建小游戏。`);
