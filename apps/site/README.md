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
- **Legal:** `src/legal/*.md` – fill in the `[placeholders]` before going live.

## Hosting under /slider

On the Slider server, Slider's own Caddy serves the site as well
(`deploy/docker-compose.website.yml`, files in `deploy/website/`). In `deploy/.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.website.yml
WEBSITE_DOMAIN=bertro.dev
```

`docker compose up -d --build` then builds the site from the checkout into a small container,
and Caddy routes `https://bertro.dev/slider/…` to it; every other path on the domain redirects
to `/slider/`. DNS for `bertro.dev` must point at the server, like `slider.bertro.dev`.
