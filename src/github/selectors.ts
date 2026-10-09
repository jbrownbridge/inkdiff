// Every GitHub DOM hook used by the adapter. Captured from the logged-in
// "new Files changed experience" (rust-lang/rfcs#4008, 2026-10).
// Prefer data-* and ARIA hooks; hashed CSS-module classes only as prefix matches.
export const S = {
  /** One element per changed file: the labelled region holding header + diff. */
  fileContainer: '[role="region"][id^="diff-"]',
  /** File path text in the file header (wrapped in U+200E marks). */
  filePath: '[data-diff-header-wrapper] h3 code',
  /** Fallback: the diff table's aria-label is "Diff for: <path>". */
  filePathLabelled: 'table[aria-label^="Diff for: "]',
  filePathLabelPrefix: 'Diff for: ',
  /** Rich/source view switch: a SegmentedControl labelled "File view". */
  viewToggleButton: 'ul[aria-label="File view"] button, [data-component="SegmentedControl"] button',
  /** Accessible names (tooltip text via aria-labelledby) and icon fallbacks. */
  richToggleLabels: ['Display the rich diff', 'rich diff'],
  sourceToggleLabels: ['Display the source diff', 'source diff'],
  richToggleIcon: 'svg.octicon-file',
  sourceToggleIcon: 'svg.octicon-code',
  /** The source diff of one file. */
  diffBody: 'table[data-diff-anchor]',
  diffRow: 'tr.diff-line-row',
  /** Code cell of one side of a row; data-diff-side is "left" or "right". */
  rowCell: 'td.diff-text-cell[data-diff-side]',
  /** data-diff-line-key looks like "b:12-l:null-r:12"; the r: part is the right line. */
  lineKeyAttr: 'data-diff-line-key',
  rightLineNumber: '[data-diff-side="right"][data-line-number]',
  /** Any left-side cell of a row (line-number gutter or code cell); its number is the old-file line. */
  leftSide: '[data-diff-side="left"]',
  hunkCell: 'td.diff-hunk-cell',
  hunkText: 'code.hunk .diff-text-inner',
  viewerLogin: 'meta[name="user-login"]',
  /** The global-nav user-menu button carries data-login; its avatar img's alt is the display name. */
  viewerMenuAvatar: '[data-login] img[data-component="Avatar"]',
  avatarHost: 'avatars.githubusercontent.com',
  rowText: '.diff-text-inner',
  rowCode: 'code.diff-text',
  addRow: 'addition',
  delRow: 'deletion',
  /** Embedded React payload holding the PR's head SHA and thread data. */
  embeddedData: 'script[data-target="react-app.embeddedData"]',
  /** One review thread, keyed by its database id. */
  thread: '[data-marker-id]',
  threadIdAttr: 'data-marker-id',
  /** Heading text: "Comment on line R126" / "Comment on lines R154 to R155". */
  threadHeading: 'h2',
  threadLabel: '[data-component="Label"]',
  threadResolvedText: 'Resolved',
  /** Label on a comment of a review the viewer has not submitted yet. */
  commentPendingText: 'Pending',
  /** When a comment was made (GitHub's relative-time element, or a plain time). */
  commentTime: 'relative-time[datetime], time[datetime]',
  /** Rendered comments of an expanded thread (not present while collapsed). Observed: `.markdown-body`. */
  commentBody: '.markdown-body, .comment-body',
  /** Observed: an image-only avatar link, then the named link `a[data-testid="avatar-link"]`; the first with text wins. */
  commentAuthor: 'a[data-testid="avatar-link"], a[data-hovercard-type="user"], a.author',
  /** Rendered in a diff row while it is hovered; clicking it opens the inline comment form. */
  addCommentButton: 'button[aria-label="Add comment"]',
  /** The open, unsent inline comment form; its parent (`div.border.rounded-2`) is the box we host. */
  newCommentMarker: '[data-marker-id="new-comment"]',
  /** Form heading: "Add a comment on  line R3" / "Add a comment on  lines R3 to R6" (double space). */
  newCommentHeading: 'h4',
  newCommentTextarea: 'textarea',
  newCommentCancel: 'Cancel',
  /** Buttons that send the form; the first present is what Ctrl/Cmd+Enter sends. */
  newCommentSubmitLabels: ['Add review comment', 'Comment', 'Add single comment', 'Start a review'],
  /** An open @mention / #reference suggestion list: Escape closes that, not the form. */
  suggester: '[role="listbox"]',
  /** Right-side code cell of a row; GitHub renders Add comment only when this cell is hovered (live check). */
  rightCodeCell: 'td.diff-text-cell[data-diff-side="right"]',
  /** Right line-number cell; a click selects the line, a shift-click extends the selection. */
  rightNumberCell: 'td.new-diff-line-number[data-diff-side="right"]',
} as const;
