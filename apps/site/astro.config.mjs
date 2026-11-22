import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/*
 * The website of the office and its four apps: static pages at bertro.dev (`/office`, `/slider`,
 * `/writer`, `/solver`, `/cloud`), the personal page at `/me` (`public/me`, one static file). The
 * apps themselves run elsewhere (Slider on office.bertro.dev). Avatars and cursors are the app's
 * own React components (apps/web/src), rendered to plain HTML at build time – no React in the
 * browser.
 */
export default defineConfig({
  site: 'https://bertro.dev',
  trailingSlash: 'ignore',
  integrations: [react()],
  redirects: {
    // The domain opens on the office.
    '/': '/office/',
    // Plans are the office's: one plan covers every app.
    '/slider/pricing': '/office/#plans',
    '/slider/de/pricing': '/office/de/#plans',
    '/slider/fr/pricing': '/office/fr/#plans',
    // Product and Vision went into Slider's homepage.
    '/slider/product': '/slider/',
    '/slider/vision': '/slider/',
  },
  // Astro's dev toolbar sits as a purple bar over the footer in `astro dev`.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss(), sliderApiInDev(), personalPageInDev()],
    // The same browsers as the app's Vite build: CSS gets the prefixes Safari 16 still needs (e.g.
    // -webkit-backdrop-filter for the glass surfaces).
    build: { cssTarget: ['chrome111', 'edge111', 'firefox128', 'safari16.4'] },
    resolve: {
      alias: {
        // The app's components import each other via `@/…`.
        '@': fileURLToPath(new URL('../web/src', import.meta.url)),
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});

/**
 * In `astro dev`, `/me` shows the personal page: Vite serves `public/me/index.html` only under its
 * full name, Caddy (deploy/website/Caddyfile) finds a folder's index.html by itself.
 */
function personalPageInDev() {
  return {
    name: 'personal-page-in-dev',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/me' || req.url === '/me/') req.url = '/me/index.html';
        next();
      });
    },
  };
}

/**
 * In `astro dev`, `/slider/api/…` (contact form, live comments) goes to the local Slider API, as
 * Caddy does in production (deploy/website/website.caddy). A middleware of its own instead of
 * Vite's `server.proxy`: it streams, so the live comments' event stream passes through.
 */
function sliderApiInDev() {
  const target = new URL(process.env.SLIDER_API_URL ?? 'http://localhost:8787');
  return {
    name: 'slider-api-in-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.replace(/^\/slider(?=\/api\/)/, '');
        if (!path?.startsWith('/api/')) return next();
        const upstream = request(
          {
            host: target.hostname,
            port: target.port,
            method: req.method,
            path,
            headers: { ...req.headers, host: target.host },
          },
          (answer) => {
            res.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(res);
          },
        );
        upstream.on('error', () => {
          res.statusCode = 502;
          res.end();
        });
        // The browser went away (a closed stream): end the upstream request too.
        res.on('close', () => upstream.destroy());
        req.pipe(upstream);
      });
    },
  };
}
