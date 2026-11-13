# Slider

Feedback on presentations, right on the slide. Link a presentation from Nextcloud or a plain
link, or upload a `.pptx`. Your team pins comments, frames, arrows and
drawings to the exact spot on a slide, replies and ticks them off. Linked decks update when the
file changes, and comments stay on their slides. Edit the slides right in the browser, let the
AI turn comments into the next version, or work offline in the desktop app. Collect research
next to the slides and ask about it, and connect Claude or ChatGPT over MCP.

Hosted version: [slider.bertro.dev](https://slider.bertro.dev) | Website:
[bertro.dev/slider](https://bertro.dev/slider)

## Run it yourself

Needs a Linux server with Docker and a domain that points at it.

```bash
git clone https://github.com/Root-Bert/slider.git
cd slider/deploy
cp .env.example .env          # set SLIDER_DOMAIN and POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs slider    # setup page address and "Setup token: …"
```

Open the setup page, enter the setup token and add a login (Microsoft, Google, Nextcloud or
OIDC). Then sign in and enter the token once more to become admin.

Full guide (German): [docs/self-hosting.md](docs/self-hosting.md).

## Desktop app

Slider for Mac (Apple Silicon) and Linux (x64 and arm64, AppImage and deb) is on the
[latest release](https://github.com/Root-Bert/slider/releases/latest). It works offline, keeps
presentations on your computer and can sign in to slider.bertro.dev or your own server
(„Anderer Server“ on the account page). On a Mac it loads LibreOffice on first start if none is
installed; on Linux install it with your package manager.

## Develop

Requirements: [Bun](https://bun.com) ≥ 1.3 and Node.js ≥ 22. The database is embedded (PGlite),
nothing else to install.

```bash
bun install
bun run dev        # API on :8787, web app on http://localhost:5173
bun run seed       # optional: demo workspace (wipes the local database)
```

Logins are optional locally: copy `.env.example` to `.env` and fill in what you need. Slides are
drawn and edited with LibreOffice (`brew install --cask libreoffice`); without it decks show a
built-in preview and the editor stays closed.

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `bun run dev`       | API + web app with hot reload                    |
| `bun run test`      | Unit and API tests (Vitest; not `bun test`)      |
| `bun run e2e`       | Browser tests (Playwright)                       |
| `bun run lint`      | ESLint                                           |
| `bun run typecheck` | TypeScript for every workspace                   |
| `bun run build`     | Production build                                 |
| `bun run start`     | Run the production build (`NODE_ENV=production`) |
| `bun run desktop`   | Build and start the desktop app (Electron)       |

## Contributing

Issues and pull requests are welcome. This repository receives each release as one commit, so
accepted pull requests are taken over by hand into the next release. By opening one you agree
that your contribution may be used under this repository's license and under Slider's commercial
licenses. Please run `bun run lint && bun run typecheck && bun run test` first.

## License

Slider is open source under the [European Union Public Licence v1.2](LICENSE) (EUPL-1.2). You
may use, change and host it, including commercially. If you distribute a changed version or offer
it to others over a network, you must share its source code under the EUPL or one of the
compatible licenses it lists. All 23 language versions of the EUPL are equally valid; the German
one is in [LICENSE.de.txt](LICENSE.de.txt).

The EUPL covers the code. The name Slider, its logo and the website's texts and pictures
(`apps/site`) are not licensed under it: all rights reserved.

Support, hosting and operation for public administrations and companies, as well as a commercial
license for those who need other terms: slider@bertro.dev.
