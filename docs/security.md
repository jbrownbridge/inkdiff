# How Inkdiff stays safe

Inkdiff shows Markdown and Mermaid files from pull requests as rendered documents inside github.com. Those files come from anyone who can open a pull request, so Inkdiff treats them as hostile. This page explains where the risks are and what stops each one. To report a problem, see [SECURITY.md](../SECURITY.md).

## What runs where

Inkdiff asks Chrome for one permission (`storage`) and one site (`https://github.com/*`). It has no server.

```mermaid
%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%
flowchart TB
  subgraph Browser["Your browser"]
    direction TB
    subgraph Page["github.com tab"]
      direction LR
      GH["GitHub's<br>page"]
      PS["page.js"]
      CS["content.js"]
    end
    BG["background.js"]
    ST[("Extension<br>storage")]
  end
  RAW["GitHub<br>raw host"]
  GHCOM["github.com"]
  CS -- "cache" --> ST
  BG -- "opens" --> ST
  CS -- "public files" --> RAW
  CS -- "private files,<br>kill switch" --> GHCOM
```

- **Requests:** file sources come from `raw.githubusercontent.com` without cookies. Only for private repos does Inkdiff use github.com's Raw link with your session. When GitHub opens a pull request without reloading the page, Inkdiff reads the pull request's data from github.com's own JSON routes with your session, as GitHub's page does; the repository name is checked first. The kill switch is read from github.com once a day, without cookies.
- **content.js** reads the page, renders files and hosts GitHub's comment form. It runs in Chrome's isolated world. Page scripts cannot read its variables or call its functions.
- **page.js** runs in the page's own world. It does one thing: GitHub's React code may try to remove a comment form or thread that Inkdiff has moved into its view. page.js stops that, but only for elements Inkdiff marked. It also sets one CSS class that hides Markdown source diffs until Inkdiff takes over.
- **background.js** has one job: it lets content.js use `chrome.storage.session`.

## Rendering untrusted Markdown

Every file passes through the same steps before anything reaches the page.

```mermaid
%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%
flowchart TD
  A["PR<br>Markdown"] --> B["Parse"]
  B --> C["Make raw<br>HTML inert"]
  C --> D["Unwrap<br>wrappers"]
  D --> E["DOMPurify<br>allowlist"]
  E --> F["Rewrite links<br>and images"]
  F --> G["Rendered<br>view"]
  G --> H["Notes for<br>hidden changes"]
```

The steps, in order: parse the Markdown (remark, GFM); turn raw HTML that could swallow the rest of the file (`textarea`, `template`, `script`, ...) into text; unwrap any element that would wrap later blocks; sanitize with DOMPurify and a strict allowlist (no scripts, styles, forms, SVG, MathML or media); rewrite links and images (images only from GitHub's hosts); then show a yellow note for any changed line that renders as nothing.

What each step stops:

| Risk | What stops it |
|---|---|
| Script in the Markdown | DOMPurify removes scripts, event handlers and `javascript:` links. |
| A fake login form or button | Forms, inputs and buttons are removed. |
| An unclosed `<a>` or `</p><label>` that wraps GitHub's comment box, so a click there follows the attacker's link | Any element that would hold whole blocks is unwrapped, before and after sanitizing. |
| Content painted over GitHub's page | No style attributes, no inline SVG, and the view uses `contain: paint`. |
| Tracking images | Images load only from GitHub's own hosts. Other images become a plain link. |
| A change you cannot see (HTML comment, `[//]: #` line, hidden element) | Changed hidden content shows in a yellow note. Bidirectional text shows a warning, as on GitHub. |
| Page freezes from crafted input | The patterns that check author input run in linear time, and sources over 1 MB are not rendered. |

## Rendering Mermaid diagrams

Mermaid draws its diagram inside the page before Inkdiff can sanitize the result. So Inkdiff checks the diagram's source first, and refuses to render one that could make the browser load a file.

```mermaid
%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%
flowchart TD
  A["Diagram<br>source"] --> B{"Can it load<br>a file?"}
  B -- yes --> R["Not<br>rendered"]
  B -- no --> C["Mermaid,<br>strict mode"]
  C --> D["DOMPurify<br>on the SVG"]
  D --> E["Neuter<br>escaping CSS"]
  E --> F["Shown, clipped<br>to its box"]
```

A diagram is refused when its source has CSS links (`url()`, `image-set()`, `@import`), image tags, image nodes or sequence participant icons. A refused diagram shows its source, with a note why. The source check decodes HTML entities, Mermaid entities and CSS, JSON and YAML escapes before it looks. A diagram's own settings cannot change the security level, the theme CSS or fonts.

## Reading file sources

```mermaid
%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%
flowchart TD
  A["Inkdiff needs<br>a file"] --> B["Ask the raw host<br>(no cookies)"]
  B --> C{"Found?<br>(public repo)"}
  C -- "yes" --> D["Use the file"]
  C -- "no" --> E["Ask github.com<br>(your session)"]
  E --> D
```

- After a 404 from the raw host, Inkdiff remembers that the repo needs your session, for this browser session only.
- File paths and repository names are checked before any request, so a crafted path cannot point at another github.com page.
- Requests give up after 20 seconds, and files over 1 MB are refused.
- Prefetching reads at most 25 files per page, after the page has loaded, and stops on the first 403 or 429 answer.

## What is stored

| Data | Where | Who can read it | How long |
|---|---|---|---|
| Settings (3 on/off options) | `chrome.storage.sync` | Inkdiff only | Until you change them |
| Last kill-switch answer | `chrome.storage.local` | Inkdiff only | Refreshed daily |
| File sources | `chrome.storage.session` | Inkdiff only | Until the browser closes, or you change GitHub account |
| Unsent comment drafts | Memory | Inkdiff only | Until the page closes |
| "Open rendered by default" flag | github.com local storage | Scripts on github.com | Until you change the setting |

The flag in github.com's storage holds no content. It exists only so the first paint can hide the source diff.

## Kill switch

Once a day at most, Inkdiff reads [`killswitch.json`](../killswitch.json) from this repository, without cookies or a Referer. The file can turn off a whole version, or one feature (`host-threads`, `native-form`, `early-hide`) that then falls back to a safer mode. If GitHub changes its pages in a way that breaks Inkdiff, the maintainer can switch it off for everyone without a store release. The answer is kept in extension storage, where github.com pages cannot change it.

## Release integrity

- GitHub Actions are pinned to commit SHAs. Each workflow gets only the permissions it needs.
- The release build runs with a read-only token. The publish job runs no npm code.
- The release zip is reproducible: the same commit always gives the same bytes. Each release has a build provenance attestation.
- Dependencies are pinned in `package-lock.json`. Dependabot and CodeQL watch them, and `npm audit` reports no known vulnerabilities at release.

## Limits

- Scripts that already run on github.com can see what the rendered view shows, as they can see GitHub's own rich view.
- github.com pages can tell that Inkdiff is installed, because its diagram files have a fixed extension URL.
- Mermaid diagrams are protected by a source check. A later release will render them in a sandboxed extension page that cannot load files at all.
