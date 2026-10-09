import type { DiffInfo, LineRange } from '../core/diff-map';
import type { Hunk } from '../core/hunks';

export type FileKind = 'markdown' | 'mermaid';

const MARKDOWN = /\.(md|mdx|markdown)$/i;
const MERMAID = /\.mmd$/i;

/** What the panel renders for this path; null for files it leaves alone. */
export function fileKind(path: string): FileKind | null {
  if (MARKDOWN.test(path)) return 'markdown';
  if (MERMAID.test(path)) return 'mermaid';
  return null;
}

export interface MdFile {
  path: string;
  /** 'mermaid' for a .mmd file: one diagram, always rendered. */
  kind: FileKind;
  repo: string;
  pr: number;
  headSha: string;
  container: HTMLElement;
}

export interface ThreadComment {
  author: string;
  bodyHtml: string;
  /** The author's avatar; shown only when GitHub-hosted. */
  avatarUrl?: string | null;
  /** ISO time the comment was made. */
  createdAt?: string | null;
  /** Part of a review the viewer has not submitted yet. */
  pending?: boolean;
}

export interface ThreadInfo {
  id: string;
  startLine: number;
  endLine: number;
  resolved: boolean;
  comments: ThreadComment[];
}

/** What an event inside a hosted native form does to it: closes it, or sends it (it may stay on failure). */
export type NativeAction = 'cancel' | 'submit';

/**
 * GitHub's own inline comment form, opened for hosting in the rendered view. Everything that reads
 * or writes GitHub's markup lives here; the view treats `box` as an opaque element it moves.
 */
export interface NativeForm {
  /** The form's box (the new-comment marker's parent), free to move into the rendered view. */
  box: HTMLElement;
  /** Put the box back where GitHub rendered it; a no-op when it is there or that place is gone. */
  restore(): void;
  /** The comment text as typed. */
  text(): string;
  /** Replace the comment text the way typing would (GitHub's React state sees it). */
  fill(text: string): void;
  focus(): void;
  /**
   * Classify a click or keydown seen in the capture phase, before GitHub handles it: an enabled
   * Cancel or Escape (no suggestion list open, not already handled) → 'cancel'; an enabled
   * Comment / Start a review / Add review comment / Add single comment, or Ctrl/Cmd+Enter in the
   * textarea → 'submit'; anything else → null.
   */
  actionOf(e: Event): NativeAction | null;
  /** Call `onGone` once if GitHub unmounts the form; returns a stop function. */
  watch(onGone: () => void): () => void;
  /**
   * After a submit with the box restored: 'gone' when GitHub removes the form (posted), 'kept'
   * when it is still there once GitHub settles (an error, or validation), so it can be hosted again.
   */
  settle(): Promise<'gone' | 'kept'>;
}

/** A GitHub element moved into the rendered view; `restore` puts it back where GitHub rendered it. */
export interface HostedBox {
  box: HTMLElement;
  restore(): void;
}

export interface GitHubAdapter {
  /** Null when the reviewer can comment; otherwise a short note shown instead of all comment UI. */
  readonly readOnlyNote: string | null;
  pageLooksSupported(doc: Document): boolean;
  findMarkdownFiles(doc: Document, url: URL): MdFile[];
  richToggle(file: MdFile): HTMLElement | null;
  sourceToggle(file: MdFile): HTMLElement | null;
  diffBody(file: MdFile): HTMLElement | null;
  readDiff(file: MdFile): DiffInfo;
  /** Hunk headers in order; [] when none can be read. */
  readHunks(file: MdFile): Hunk[];
  /** Avatar URL of the signed-in viewer (a GitHub-hosted image), or null. */
  viewerAvatar(doc: Document): string | null;
  readThreads(file: MdFile): ThreadInfo[];
  revealSourceLine(file: MdFile, line: number): void;
  /** Open GitHub's own comment form for `lines`; null when it cannot. Absent where unsupported. */
  openNativeForm?(file: MdFile, lines: LineRange): Promise<NativeForm | null>;
  observe(file: MdFile, onChange: () => void): () => void;
  /** Posted threads drawn in GitHub's source diff (right side only), for a "View rendered" link. */
  threadMarkers?(file: MdFile): { id: string; el: HTMLElement }[];
  /** False when threads show but cannot be read (GitHub changed its markup): keep GitHub's view. */
  threadsReadable?(file: MdFile): boolean;
  /** GitHub's own element for a posted thread, ready to move into the rendered view. Absent where unsupported. */
  hostThread?(file: MdFile, threadId: string): HostedBox | null;
  /** Every Markdown file the PR changes (still present at head), for prefetching; [] when unknown. */
  markdownRefs?(doc: Document, url: URL): { repo: string; sha: string; path: string }[];
  /** The signed-in viewer's login, or null. */
  viewerLogin?(doc: Document): string | null;
}
