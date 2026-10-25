import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { appConfig, environments } from './app.config.ts';

const proxy = {
  '/api': { target: environments.development.apiOrigin },
  '/media': { target: environments.development.apiOrigin },
};
export default defineConfig({
  plugins: [react()],
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
