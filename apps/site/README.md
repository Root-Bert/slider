# The office's website

The website at **bertro.dev** – static pages built with Astro: the office (`/office`, where the
domain opens) introduces all four apps at once, each app has a page of its own (`/slider`,
`/writer`, `/solver`, `/cloud`), and `/me` is the personal page (`public/me`, one static HTML file
and its `assets/`, copied in as is). Slider's blog, contact, legal and download pages stay under
`/slider/…`. The apps themselves run elsewhere (Slider at slider.bertro.dev); this package is not
part of the Docker image.

```sh
bun run dev:site          # http://localhost:4321/office/
cd apps/site && bun run build   # → apps/site/dist
```

- **Apps:** `src/lib/apps.ts` lists them and says which one can be used today (`isLive`); the
  others show „Coming soon“ and still lead to an account, which includes every app. Their words
  are in `src/i18n/suite.ts`, their marks in `src/components/Mark.astro` (Figma file "Slider",
  page "Brand Guide"; Cloud's mark is drawn here, the guide has none yet).
- **Pages:** the office is `src/components/office/Office.astro`, Writer, Solver and Cloud share
  `src/components/product/Product.astro`, Slider keeps its own (`src/components/home/`). Each app
  is shown as one object (`src/components/objects/`), drawn in units of its own width so it is
  the same picture at every size; `src/scripts/tilt.ts` leans them towards the pointer.
- **Plans:** one plan covers the whole office, no app is sold on its own
  (`src/components/Plans.astro`, on every page; `/slider/pricing` leads to the office's).
- **Same look as the app:** `src/styles/site.css` imports the app's tokens and utilities
  (`apps/web/src/styles/index.css`), and avatars, live cursors, the logo and buttons are the
  app's own React components (`@/…` resolves to `apps/web/src`). Astro renders them to plain
  HTML at build time; the browser gets no React.
- **Design:** Figma file "Slider", page "Agent Website" (Site Kit has the components and the
  motion spec). Personas and their colours: `src/lib/people.ts`.
- **Motion:** sections with `data-section` play their entrance once in view
  (`src/scripts/motion.ts`); `data-reveal`, `data-draw` and `data-drift` are styled in
  `site.css`. Reduced motion shows the final state.
- **Languages:** English right under a page's address (`/office/`, `/slider/`), German and
  French under their code (`/office/de/`, `/slider/fr/`; texts in `src/i18n/`). A first visit to an English page follows the browser's language; the
  footer's switch remembers a choice. Blog posts stay English, Impressum/Datenschutz German.
- **Light and dark** follow the system: the app's light tokens under `data-theme="light"`. Use
  tokens (`text-fg`, `bg-surface-1`, …), never hard white, so both work.
- **Live comments:** every page shows who else is there and lets anyone comment anywhere
  (`src/components/live/`, `src/scripts/live.ts`); comments go 30 s after the last touch. The
  server is Slider's API (`apps/api/src/realtime/site-live.ts`, in memory only), reached via
  `/slider/api/site-live` (`API_URL`; Caddy in production, a dev middleware in `astro.config.mjs`). Without
  that API the dock simply doesn't show.
- **Legal:** `src/legal/*.md` – fill in the `[placeholders]` before going live.

## Hosting

On the Slider server, Slider's own Caddy serves the site as well
(`deploy/docker-compose.website.yml`, files in `deploy/website/`). In `deploy/.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.website.yml
WEBSITE_DOMAIN=bertro.dev
```

`docker compose up -d --build` then builds the site from the checkout into a small container,
and Caddy routes `https://bertro.dev/…` to it: the root redirects to `/office/`, unknown paths get
the site's 404 page. DNS for `bertro.dev` must point at the server, like `slider.bertro.dev`.

## License

The website's code is under the repository's EUPL-1.2. Its texts and pictures, and the name and
logo of Slider, are not: all rights reserved. The fonts in `src/components/slides/fonts/` are
under the SIL Open Font License (`OFL.txt` there). Blog posts with `draft: true` are not
published to the public repository until they go live.
