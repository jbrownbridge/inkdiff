/** Hooks into GitHub's classic (server-rendered) PR Files page. Verified against logged-out captures, 2026-10. */
export const C = {
  /** One element per changed file. */
  file: '.file[data-tagsearch-path]',
  pathAttr: 'data-tagsearch-path',
  deletedAttr: 'data-file-deleted',
  /** The new page's file region; present only on the new page. */
  newPageRegion: '[role="region"][id^="diff-"]',
  /** Rich/source toggles in the file header. */
  richToggle: 'button[aria-label="Display the rich diff"]',
  sourceToggle: 'button[aria-label="Display the source diff"]',
  /** The toggle form's action holds sha2=<head>; fallback: end_commit_oid in a data-url. */
  toggleForm: 'form.js-prose-diff-toggle-form[action]',
  comparisonUrl: '[data-url*="end_commit_oid="]',
  diffTable: 'table.diff-table',
  hunkCode: 'td.blob-code-hunk',
  codeCell: 'td.blob-code',
  codeInner: '.blob-code-inner',
  numCell: 'td.blob-num',
  addCode: 'blob-code-addition',
  delCode: 'blob-code-deletion',
  /** Number cells carry id="diff-<hash>R<n>" (new side) or "...L<n>" (old side). */
  inlineCommentsRow: 'tr.inline-comments',
  thread: 'review-thread-collapsible, .review-thread-component',
  threadFrame: 'turbo-frame[id^="review-thread-or-comment-id-"]',
  threadFramePrefix: 'review-thread-or-comment-id-',
  threadStart: '.js-multi-line-preview-start',
  threadEnd: '.js-multi-line-preview-end',
  commentBody: '.js-comment-body',
  commentAuthor: 'a.author',
} as const;
