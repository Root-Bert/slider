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
  // Astro's dev toolbar sits as a purple bar over the footer in `astro dev`.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    // The same browsers as the app's Vite build: CSS gets the prefixes Safari 16 still needs (e.g.
    // -webkit-backdrop-filter for the glass surfaces).
    build: { cssTarget: ['chrome111', 'edge111', 'firefox128', 'safari16.4'] },
    // In production Caddy passes the contact form's POST to Slider (deploy/website/website.caddy).
    server: {
      proxy: {
        '/slider/api': {
          target: process.env.SLIDER_API_URL ?? 'http://localhost:8787',
          rewrite: (path) => path.replace(/^\/slider/, ''),
        },
      },
    },
    resolve: {
      alias: {
        // The app's components import each other via `@/…`.
        '@': fileURLToPath(new URL('../web/src', import.meta.url)),
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});
