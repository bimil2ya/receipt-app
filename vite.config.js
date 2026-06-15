import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createLocalNodeResponse(res) {
  let ended = false;
  const api = {
    statusCode: 200,
    setHeader(key, value) {
      res.setHeader(key, value);
      return api;
    },
    status(code) {
      api.statusCode = code;
      res.statusCode = code;
      return api;
    },
    json(data) {
      if (ended) return api;
      ended = true;
      res.statusCode = api.statusCode;
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return api;
    },
    send(data) {
      if (ended) return api;
      ended = true;
      res.statusCode = api.statusCode;
      if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      } else {
        res.end(data);
      }
      return api;
    },
    end(data) {
      if (ended) return api;
      ended = true;
      res.statusCode = api.statusCode;
      res.end(data);
      return api;
    },
    redirect(location) {
      if (ended) return api;
      ended = true;
      res.statusCode = api.statusCode >= 300 && api.statusCode < 400 ? api.statusCode : 307;
      res.setHeader('Location', location);
      res.end();
      return api;
    },
  };
  return api;
}

function localApiMiddleware() {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      server.middlewares.use('/api', async (req, res, next) => {
        try {
          const pathname = new URL(req.originalUrl || req.url || '/', 'http://127.0.0.1').pathname;
          const routePath = pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
          if (!routePath) return next();

          const localFile = path.resolve(process.cwd(), 'api', `${routePath}.js`);
          const apiFile = existsSync(localFile) ? pathToFileURL(localFile).href : null;
          if (!apiFile) return next();

          const mod = await import(`${apiFile}?t=${Date.now()}`);
          if (typeof mod.default !== 'function') return next();

          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          const url = new URL(req.originalUrl || req.url || '/', 'http://127.0.0.1');

          if (mod.default.length >= 2) {
            const localReq = {
              ...req,
              method: req.method,
              headers: req.headers,
              query: Object.fromEntries(url.searchParams.entries()),
              body: body ? JSON.parse(body.toString() || '{}') : undefined,
            };
            await mod.default(localReq, createLocalNodeResponse(res));
            return;
          }

          const request = new Request(url, {
            method: req.method,
            headers: req.headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
            duplex: body ? 'half' : undefined,
          });

          const response = await mod.default(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const buffer = Buffer.from(await response.arrayBuffer());
          res.end(buffer);
        } catch (error) {
          console.error('[local-vercel-api]', req.method, req.originalUrl || req.url, error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: false,
            error: '로컬 API 오류',
            detail: error?.stack || error?.message || String(error),
          }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    localApiMiddleware(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: '법인카드 영수증 정산',
        short_name: '영수증정산',
        description: '법인카드 영수증을 촬영하고 정산하는 앱',
        theme_color: '#3b82f6',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 👴 노장의 조언: 캐시 업데이트 즉시 반영
        skipWaiting: true,
        clientsClaim: true,
        // /api/* 경로는 서비스워커가 가로채지 않고 서버로 직접 전달
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
