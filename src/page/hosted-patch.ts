/** Attribute on GitHub elements we moved into the rendered view; the patch below applies only to them. */
export const HOSTED_ATTR = 'data-mdr-hosted';

const PATCHED = Symbol.for('inkdiff.hosted-patch');

/**
 * Let React keep working on GitHub elements we moved. React removes and inserts children on the
 * parent it rendered them in; for a hosted element that parent is no longer right and the DOM call
 * throws, which breaks GitHub's diff. For hosted elements only: removing one removes it from where
 * it is now, and inserting before one appends instead. Every other call is unchanged.
 * Runs in the page's world (React's), so it must not import anything.
 */
export function installHostedPatch(win: Window & typeof globalThis): void {
  const proto = win.Node.prototype as Node & { [PATCHED]?: true };
  if (proto[PATCHED]) return;
  proto[PATCHED] = true;
  const hosted = (n: Node | null): n is Element => n instanceof win.Element && n.hasAttribute(HOSTED_ATTR);
  // Each skip is logged at debug level: a burst means GitHub changed how it renders threads.
  const skipped = (what: string, el: Element) => win.console.debug(`[Inkdiff] hosted patch: ${what}`, el);
  const removeChild = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (hosted(child) && child.parentNode !== this) {
      skipped('removeChild of a moved element', child);
      child.remove();
      return child;
    }
    return removeChild.call(this, child) as T;
  };
  const insertBefore = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (hosted(ref) && ref.parentNode !== this) {
      skipped('insertBefore a moved element', ref);
      return insertBefore.call(this, node, null) as T;
    }
    return insertBefore.call(this, node, ref) as T;
  };
}
