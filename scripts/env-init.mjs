import fs from 'node:fs';
import crypto from 'node:crypto';
const file = 'backend/.env.local';
if (!fs.existsSync(file)) {
  const text = fs
    .readFileSync('backend/.env.example', 'utf8')
    .replace(/^JWT_SECRET=$/m, `JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`)
    .replace(
      /^ADMIN_PASSWORD=$/m,
      `ADMIN_PASSWORD=Pet!${crypto.randomBytes(18).toString('base64url')}`,
    );
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
  console.log('已创建 backend/.env.local，管理员密码保存在此本地文件中。');
} else console.log('保留现有本地配置。');
