import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { appConfig, environments } from './app.config.ts';

const proxy = {
  '/api': { target: environments.development.apiOrigin },
  '/media': { target: environments.development.apiOrigin },
};

function apiSkillDocument(): Plugin {
  const source = new URL('../SKILL.md', import.meta.url);
  return {
    name: 'api-skill-document',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (pathname !== '/admin/SKILL.md' && pathname !== `${appConfig.basePath}SKILL.md`)
          return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        try {
          const markdown = await readFile(source);
          response.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(request.method === 'HEAD' ? undefined : markdown);
        } catch {
          response.writeHead(404);
          response.end('API skill document not found');
        }
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'SKILL.md', source: await readFile(source) });
    },
  };
}
export default defineConfig({
  plugins: [react(), apiSkillDocument()],
  base: appConfig.basePath,
  envDir: false,
  define: { __ADMIN_CONFIG__: JSON.stringify(appConfig) },
  server: { host: '127.0.0.1', strictPort: true, proxy },
  preview: { host: '127.0.0.1', strictPort: true, proxy },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](?:react(?:-dom)?|react-router(?:-dom)?|scheduler)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
