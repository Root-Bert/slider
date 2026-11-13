# Slider website

The product website at **bertro.dev/slider** – static pages built with Astro. The app itself
runs at slider.bertro.dev; this package is not part of the Docker image.

```sh
bun run dev:site          # http://localhost:4321/slider/
cd apps/site && bun run build   # → apps/site/dist (paths are prefixed with /slider)
```

- **Same look as the app:** `src/styles/site.css` imports the app's tokens and utilities
  (`apps/web/src/styles/index.css`), and avatars, live cursors, the logo and buttons are the
  app's own React components (`@/…` resolves to `apps/web/src`). Astro renders them to plain
  HTML at build time; the browser gets no React.
- **Design:** Figma file "Slider", page "Agent Website" (Site Kit has the components and the
  motion spec). Personas and their colours: `src/lib/people.ts`.
- **Motion:** sections with `data-section` play their entrance once in view
  (`src/scripts/motion.ts`); `data-reveal`, `data-draw` and `data-drift` are styled in
  `site.css`. Reduced motion shows the final state.
- **Languages:** English at `/slider/`, German and French under `/slider/de/`, `/slider/fr/`
  (texts in `src/i18n/`). A first visit to an English page follows the browser's language; the
  footer's switch remembers a choice. Blog posts stay English, Impressum/Datenschutz German.
- **Light and dark** follow the system: the app's light tokens under `data-theme="light"`. Use
  tokens (`text-fg`, `bg-surface-1`, …), never hard white, so both work.
- **Live comments:** every page shows who else is there and lets anyone comment anywhere
  (`src/components/live/`, `src/scripts/live.ts`); comments go 30 s after the last touch. The
  server is Slider's API (`apps/api/src/realtime/site-live.ts`, in memory only), reached via
  `/slider/api/site-live` (Caddy in production, a dev middleware in `astro.config.mjs`). Without
  that API the dock simply doesn't show.
- **Legal:** `src/legal/*.md` – fill in the `[placeholders]` before going live.

## Hosting under /slider

On the Slider server, Slider's own Caddy serves the site as well
(`deploy/docker-compose.website.yml`, files in `deploy/website/`). In `deploy/.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.website.yml
WEBSITE_DOMAIN=bertro.dev
```

`docker compose up -d --build` then builds the site from the checkout into a small container,
and Caddy routes `https://bertro.dev/slider/…` to it. The domain root is the personal page
(`apps/home`, one static HTML file and its `assets/`, copied in as is); every other path redirects
there. DNS for `bertro.dev` must point at the server, like `slider.bertro.dev`.

## License

The website's code is under the repository's EUPL-1.2. Its texts and pictures, and the name and
logo of Slider, are not: all rights reserved. The fonts in `src/components/slides/fonts/` are
under the SIL Open Font License (`OFL.txt` there). Blog posts with `draft: true` are not
published to the public repository until they go live.
