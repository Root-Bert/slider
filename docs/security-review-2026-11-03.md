# Review: secrets and publication, 2026-11-03

## Result and scope

No real credentials found in the inspected Git history or publishable working files.
`Root-Bert/slider-dev` is private; `Root-Bert/slider` is public. Remote refs were fetched
before scanning, including the public branch and all seven release tags. This is a review
of credential exposure through Git, release publication, and build configuration; it is
not a production penetration test or a dependency vulnerability audit.

Checks performed:

- Gitleaks 8.30.1 over all reachable local and fetched remote history: 857 scanned commits.
- Separate scan of the seven public release commits: no findings.
- Scan of tracked and non-ignored working files, including uncommitted changes and archive
  contents up to two levels deep: no findings after reviewed dummy exceptions.
- Exact comparison of seven local environment credential values against 11,254 reachable
  Git blobs: no matches. Values were neither logged nor sent to GitHub or search services.
- GitHub public-repository secret-scanning alerts: empty; secret scanning and push protection
  enabled. The seven public releases have no attached assets.
- Frontend build configuration: no blanket environment injection found. Docker builds exclude
  environment files and copy the built frontend into the runtime image/static website.

Six initial history findings were literal dummy credentials in mocked integration tests.
The added exceptions require both the exact dummy value and that specific test path; all
other values in tests remain scanned. The existing historical e2e dummy exception and the
existing documentation-placeholder configuration are preserved.

## Findings addressed

1. Git ignored `.env` but allowed variants such as `.env.local` and `.env.production`.
   Ignore rules now also cover those variants, local private-key files and credential
   directories. `.env.example` files remain trackable. Docker exclusions also cover local
   agent settings and private-key files.
2. The existing release CI secret scan did not run on ordinary pushes or pull requests.
   A separate lightweight workflow now scans on every push and PR.
3. Public publishing ran independently of CI, so a failed scan could not stop publication.
   `publish.yml` now fetches full history and requires a successful scan before loading the
   public repository's SSH write key.
4. A remote scan runs after upload. A local pre-push hook now scans committed history before
   upload and blocks if Gitleaks is absent. Gitleaks was installed and `core.hooksPath` set
   to `.githooks` in this checkout.

## Running the checks

Run `bun run security:secrets` to scan committed history. New checkouts must install Gitleaks
and enable the local hook with `git config --local core.hooksPath .githooks`. The hook does not
scan uncommitted edits, which Git cannot push; the review separately scanned those files.

Validation also covered shell syntax, workflow/package formatting, ignore rules, and four
scanner checks: reviewed dummy values pass, an unexpected key fails, the dummy exception
does not apply in production files, and a missing scanner blocks the hook.

Pattern scanners cannot prove the absence of every possible secret. Hooks can be bypassed;
the publication gate provides a separate check. These workflow changes take effect remotely
after the user pushes them. No push or deployment was performed during this review.
