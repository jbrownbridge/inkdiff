import { HOSTED_ATTR } from '../page/hosted-patch';
import { clearHome, getHome, isOrphan, setHome } from './hosted-homes';
import { threadMarkers } from './read';
import type { HostedBox, MdFile } from './types';

/**
 * GitHub's own element for a posted thread (its full UI: menu, edit, delete, reply, resolve,
 * reactions), marked so the page-world patch keeps React working once we move it. Null when
 * GitHub has not rendered it.
 */
/**
 * The file's thread markers, read once per task: a sync hosts every thread in one go, and reading
 * the markers parses every thread heading.
 */
let memo: { file: MdFile; markers: Map<string, HTMLElement> } | null = null;
function markersOf(file: MdFile): Map<string, HTMLElement> {
  if (memo?.file === file) return memo.markers;
  const markers = new Map(threadMarkers(file).map((m) => [m.id, m.el]));
  memo = { file, markers };
  queueMicrotask(() => { memo = null; });
  return markers;
}

export function hostThread(file: MdFile, threadId: string): HostedBox | null {
  // A cached marker GitHub has deleted since (its home left the page) means: read them again.
  let box = markersOf(file).get(threadId);
  if (box && isOrphan(box)) { memo = null; box = markersOf(file).get(threadId); }
  if (!box) return null;
  if (!getHome(box)) {
    if (!box.parentNode) return null;
    setHome(box, { parent: box.parentNode, next: box.nextSibling });
  }
  box.setAttribute(HOSTED_ATTR, '');
  return {
    box,
    restore() {
      const home = getHome(box);
      if (!home) return;
      clearHome(box);
      // React may have dropped it meanwhile, or replaced its row: then it stays out.
      if (box.isConnected && home.parent.isConnected && box.parentNode !== home.parent) {
        home.parent.insertBefore(box, home.next?.parentNode === home.parent ? home.next : null);
      }
      box.removeAttribute(HOSTED_ATTR);
    },
  };
}
