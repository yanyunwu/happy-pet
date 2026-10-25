import fs from 'node:fs';
const address = process.env.API_URL?.replace(/\/$/, '');
if (!address) throw new Error('请设置 API_URL，例如 https://game.example.com/api/v1');
const parsed = new URL(address);
if (
  !['https:', 'http:'].includes(parsed.protocol) ||
  parsed.username ||
  parsed.password ||
  parsed.search ||
  parsed.hash
)
  throw new Error('接口地址必须是有效 HTTP(S) 地址，不能包含凭证或查询参数');
if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname))
  throw new Error('手机微信接口需使用 HTTPS');
fs.writeFileSync(
  'minigame/assets/resources/online.json',
  JSON.stringify({ apiBaseUrl: address }, null, 2) + '\n',
);
console.log('小游戏接口地址已配置，请重新构建。');
