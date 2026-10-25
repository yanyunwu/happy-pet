const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../build', process.env.PREVIEW_BUILD || 'web-mobile');
const port = Number(process.env.PORT || 7457);
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Build web-mobile in Cocos Creator first.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.css': 'text/css', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data); });
}).listen(port, '127.0.0.1', () => console.log(`快乐萌宠消预览: http://127.0.0.1:${port}`));
