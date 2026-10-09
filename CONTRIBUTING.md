# Contributing

Thanks for helping. Bug reports, small fixes and focused features are welcome.

## License of contributions

Inkdiff is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contribution is licensed under the same license (section 5 of the license), and you certify the [Developer Certificate of Origin](https://developercertificate.org/): you wrote it, or have the right to submit it under this license.

Sign off every commit to certify this:

    git commit -s -m "fix: ..."

This adds a `Signed-off-by: Your Name <you@example.com>` line. A check on each pull request fails without it. To fix the last commit: `git commit --amend -s --no-edit`.

## Setup

You need Node.js 22 or later and Chrome (or Chromium).

    npm ci
    npm test && npm run lint && npm run typecheck
    npm run build    # load dist/ at chrome://extensions with "Load unpacked"

After each rebuild, click the reload icon on the extension card, then reload the GitHub tab.

### Checks in a real browser (optional)

These scripts use Playwright and a signed-in browser profile in `.auth/profile` (git-ignored):

    npx playwright install chromium
    npm run login                       # sign in to GitHub once in the window that opens
    npm run smoke -- <pull request URL> # load a page with the built extension; report timing and errors (read-only)

`npm run fixtures:capture` and `npm run fixtures:classic` save GitHub pages into `tests/fixtures/` (git-ignored, because they hold other people's content). The fixture tests run only when those files exist and say so when they skip. Run them before a release, and after GitHub changes its pages.

Check the behaviour by hand with [docs/manual-test.md](docs/manual-test.md).

## Guidelines

- Keep every page selector in `src/github/selectors.ts`, with a comment on where it was seen.
- Add a test for each behaviour change (Vitest + jsdom). Model pages with small synthetic DOM in the tests; never commit captured pages from other people's repositories.
- The extension must not call any server other than github.com, and must not click a submit button for the user.
- New dependencies must use a permissive license (MIT, ISC, BSD, Apache-2.0 or similar), or a weak-copyleft license the maintainer approves (today only EPL-2.0, for elkjs inside Mermaid; see NOTICE). A check on each pull request enforces this.
- One change per pull request. Describe what you checked by hand (`docs/manual-test.md`).

## Releases (maintainer)

1. Bump `version` in `public/manifest.json` and `package.json`.
2. Merge to `main`, then tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. The release workflow tests, builds and attests the package, and attaches `inkdiff-1.2.3.zip` to a GitHub release. Upload that zip to the Chrome Web Store.

## Reporting a broken page

GitHub changes its pages often. If Inkdiff stops working, open an issue with the browser console lines that start with `[Inkdiff]` and the page type (Files changed, single commit, logged out).
