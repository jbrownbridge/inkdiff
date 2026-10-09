# Manual test checklist

## Setup

1. Run `npm run build`.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `dist/` folder.
4. After each rebuild, click the reload icon on the extension card, then reload the GitHub tab.

## Read side (any pull request; nothing is posted)

Use a pull request that changes Markdown files. Treat other people's pull requests as read-only: do not post, and do not leave a comment form with text in it.

Public examples: https://github.com/rust-lang/rfcs/pull/4006 (many files), a pull request in mermaid-js/mermaid that changes `docs/` (diagrams).

- [ ] With "Open Markdown files rendered by default" on (the default), Markdown files open rendered with no flash of the source diff.
- [ ] GitHub's source toggle shows the source diff; the rich toggle shows Inkdiff's view again.
- [ ] Changed blocks have green gutter numbers. Gutter numbers match GitHub's numbers for 3 random lines.
- [ ] Only the changed sections show, with `@@` headers that match GitHub's. Each expander reveals content. **Show whole file** works.
- [ ] Removed lines show as "N lines removed"; clicking it shows them in the source diff.
- [ ] Review threads show inline under the line they belong to, looking like GitHub's. Resolved threads start collapsed.
- [ ] In the source diff, each thread has **View rendered**; it opens the rendered view at that thread.
- [ ] A ```` ```mermaid ```` block shows **Render diagram** (or renders by itself with the option on). A `.mmd` file opens rendered.
- [ ] Relative links open the file at the head commit. Images hosted outside GitHub show as an "Image: …" link.
- [ ] A changed HTML comment shows in a "Hidden comment" box. A changed `[//]: # (…)` line shows as a "does not show in the rendered view" note.
- [ ] A deleted Markdown file shows GitHub's own diff (no Inkdiff view).
- [ ] Opening a single commit or a commit range leaves GitHub's own view alone.
- [ ] Moving to another pull request without a full reload still works. Files further down render as you scroll.
- [ ] Logged out, on a public pull request, the view opens read-only with "Sign in to comment".
- [ ] The DevTools console shows no errors that start with `[Inkdiff]`.

## Comment side (only on a pull request you own)

Inkdiff hosts GitHub's own comment form and threads: GitHub posts, edits and deletes the comments.

- [ ] Hover a line: the `+` follows the pointer across the row. A single click on content (not a link, button or selection) opens the comment form at that line.
- [ ] Drag across gutter lines, or Shift-click, to comment on a range. Selecting text to copy does not open a form.
- [ ] The form is GitHub's (Write/Preview, toolbar, suggestion), placed right under the line, before any nested list.
- [ ] **Add single comment** and **Start a review**: the comment shows at once where you wrote it, then becomes GitHub's thread without a jump.
- [ ] Reply, edit, delete and resolve inside a hosted thread work. A deleted comment disappears from the rendered view.
- [ ] Switching to the source view and back keeps the threads and any open form.
- [ ] With **Show whole file** on, click a line outside the diff: the fallback form says GitHub's form could not be opened, and **Copy and open source view** copies the text and shows the source diff at that line.

Clean up: delete your test comments and any pending review.
