import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    return {
      // GitHub Pages uses /<repo-name>/ as the base path
      base: process.env.NODE_ENV === 'production' ? '/Demonstrable-Plotalizer/' : '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: env.VITE_ALLOWED_HOSTS
          ? env.VITE_ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
          : []
      },
      preview: {
        port: 4173,
        host: '0.0.0.0',
        allowedHosts: env.VITE_ALLOWED_HOSTS
          ? env.VITE_ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
          : []
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        __APP_VERSION__: JSON.stringify(`${gitShortSha()} · ${buildDate}`)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
