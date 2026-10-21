# Slider

Feedback on presentations, right on the slide. Link a PowerPoint from OneDrive, SharePoint,
Google Drive or Nextcloud, or upload a `.pptx`. Your team pins comments, frames, arrows and
drawings to the exact spot on a slide, replies and ticks them off. Linked decks update when the
file changes, and comments stay on their slides.

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

## Develop

Requirements: [Bun](https://bun.com) ≥ 1.3 and Node.js ≥ 22. The database is embedded (PGlite),
nothing else to install.

```bash
bun install
bun run dev        # API on :8787, web app on http://localhost:5173
bun run seed       # optional: demo workspace (wipes the local database)
```

Logins and link import are optional locally: copy `.env.example` to `.env` and fill in what you
need. Uploaded decks look best with LibreOffice installed (`brew install --cask libreoffice`).

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `bun run dev`       | API + web app with hot reload                    |
| `bun run test`      | Unit and API tests (Vitest; not `bun test`)      |
| `bun run e2e`       | Browser tests (Playwright)                       |
| `bun run lint`      | ESLint                                           |
| `bun run typecheck` | TypeScript for every workspace                   |
| `bun run build`     | Production build                                 |
| `bun run start`     | Run the production build (`NODE_ENV=production`) |

## Contributing

Issues and pull requests are welcome. This repository receives each release as one commit, so
accepted pull requests are taken over by hand into the next release. By opening one you agree
that your contribution may be used under this repository's license and under Slider's commercial
licenses. Please run `bun run lint && bun run typecheck && bun run test` first.

## License

Slider is open source under the [GNU Affero General Public License v3.0](LICENSE). You may use,
change and host it, including commercially. If you offer a changed version to others over a
network, you must share its source code under the same license.

The AGPL covers the code. The name Slider, its logo and the website's texts and pictures
(`apps/site`) are not licensed under it: all rights reserved.

If the AGPL doesn't work for your organisation, for example because you want to keep changes
private or your company doesn't allow AGPL software, a commercial license is available:
slider@bertro.dev.
