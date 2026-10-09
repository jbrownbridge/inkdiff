# Inkdiff privacy policy

Last updated: 2026-10-09

**In short: Inkdiff collects nothing.** It has no servers, no accounts, no analytics and no tracking. Everything it reads stays in your browser, and nothing is sent to the maintainer or anyone else.

Inkdiff is a browser extension that shows Markdown files in pull requests as rendered documents. The details are below.

## What Inkdiff reads, in your browser only

- **The pull request page** you open on github.com: which Markdown files changed, their changed lines, and their review threads (comment text, author logins and avatars), so it can show them in the rendered view.
- **The source of those files** at the pull request's head commit. For a public repository, Inkdiff asks GitHub's raw-file host (`raw.githubusercontent.com`) directly, without cookies. If that fails (for example, a private repository), it uses github.com's "Raw" link with your github.com session, the same request your browser makes when you click "View file" → "Raw".
- **Images referenced in the Markdown**, which your browser loads from GitHub's hosts (`*.githubusercontent.com`), as GitHub's own rendered view does. Images from other sites are shown as a link, and Mermaid diagrams that would load a file are not rendered.

Inkdiff does not send any of this anywhere.

## What Inkdiff stores, on your device only

- **Your settings** (three on/off options), in Chrome's extension storage. If you use Chrome sync, Chrome syncs them with your other browsers.
- **File sources** stay in the extension's memory and in Chrome's extension session storage (`chrome.storage.session`: in memory only, readable by Inkdiff only, cleared when you close the browser, or when you sign in to GitHub as someone else or sign out), so a reload needs no new request. So does the list of repositories that need your session to read. **Unsent comment drafts** stay in the extension's memory for the open page only. None of this is written to the page's storage. (What the rendered view shows is part of the page, like GitHub's own rich view, so scripts that already run on the page can see it there.)
- **On a shared computer**, treat Inkdiff's cache like your browser's own: closing the browser clears it, and signing out of GitHub clears it the next time a GitHub page loads.
- **The last kill-switch answer** (a list of version numbers), in Chrome's extension storage.
- **One small flag** in github.com's local storage, holding no content: whether files open rendered by default, so the first paint can hide the source diff.

## What Inkdiff sends

- **Nothing about you.** Comments are posted by the page's own comment form when you click its buttons, exactly as without Inkdiff.
- **One kill-switch request a day** at most, to `https://github.com/jbrownbridge/inkdiff/raw/main/killswitch.json`, **without cookies and without a Referer**, so it does not reveal your account or the page you are on. The file lists versions to switch off if GitHub's pages change in a way that breaks Inkdiff. GitHub, which hosts the file, receives the usual request data (such as your IP address) under its own privacy statement; the Inkdiff maintainer does not receive it.

## Data sale and sharing

Inkdiff does not sell, share or transfer any data. It does not use data for advertising, credit or lending decisions, or anything unrelated to its single purpose.

## Contact

For privacy questions, email **jason@loopright.com**. For other questions, open an issue at https://github.com/jbrownbridge/inkdiff/issues.
