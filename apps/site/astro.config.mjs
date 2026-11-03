import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/*
 * The product website: static pages under bertro.dev/slider, the app itself runs on
 * slider.bertro.dev. Avatars, cursors and the logo are the app's own React components
 * (apps/web/src), rendered to plain HTML at build time – no React in the browser.
 */
export default defineConfig({
  site: 'https://bertro.dev',
  base: '/slider',
  trailingSlash: 'ignore',
  integrations: [react()],
  // Product and Vision went into the homepage.
  redirects: { '/product': '/slider/', '/vision': '/slider/' },
  // Astro's dev toolbar sits as a purple bar over the footer in `astro dev`.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss(), sliderApiInDev()],
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
 * In `astro dev`, `/slider/api/…` (contact form, live comments) goes to the local Slider API, as
 * Caddy does in production (deploy/website/website.caddy). Astro 7 serves its base path before
 * Vite's `server.proxy` ever sees a request, so this is a middleware of its own; it streams, so the
 * live comments' event stream passes through.
 */
function sliderApiInDev() {
  const target = new URL(process.env.SLIDER_API_URL ?? 'http://localhost:8787');
  return {
    name: 'slider-api-in-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Astro has taken the base off by now (`/api/…`); with it, should that ever change.
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
