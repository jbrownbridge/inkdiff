/**
 * Early hide: GitHub draws a Markdown file's source diff before our content script runs, and the
 * rendered view then replaces it (a flash and a jump). At document_start, when the reviewer opens
 * files rendered by default (mirrored into localStorage, as chrome.storage is async; the default
 * is on), this marks
 * <html> so content.css hides those source diffs from the first paint. A file whose source
 * should show gets SOURCE_CLASS on its region: by its controller, or by the router when no
 * controller takes it.
 */
export const EARLY_KEY = 'mdr-early';
export const PRE_CLASS = 'mdr-pre';
export const SOURCE_CLASS = 'mdr-src';
/** Same as content.css: the file regions the early hide applies to. */
export const FILE_REGION = '[role="region"][id^="diff-"]';

export function markEarly(doc: Document, storage: Pick<Storage, 'getItem'> | null): void {
  try {
    // Missing means never saved: rendered by default is the default.
    if (storage?.getItem(EARLY_KEY) !== '0') doc.documentElement.classList.add(PRE_CLASS);
  } catch { /* storage blocked: no early hide */ }
}

export function rememberEarly(on: boolean, storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(EARLY_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}
