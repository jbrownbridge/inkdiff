/** Where each GitHub element we host came from: GitHub's place for it while it shows in our view. */
interface Home { parent: Node; next: Node | null }
const homes = new WeakMap<Element, Home>();

export function setHome(el: Element, home: Home): void { homes.set(el, home); }
export function getHome(el: Element): Home | undefined { return homes.get(el); }
export function clearHome(el: Element): void { homes.delete(el); }

/** The element to read GitHub's context from (row, diff table): its home while hosted, else itself. */
export function inGitHubPlace(el: Element): Element {
  const parent = homes.get(el)?.parent;
  return parent instanceof Element ? parent : el;
}

/**
 * A hosted element whose home GitHub removed. React unmounts a thread by removing an ancestor in
 * the diff; the element we moved out is not inside it any more, so it is gone in all but our view.
 */
export function isOrphan(el: Element): boolean {
  const home = homes.get(el);
  return home !== undefined && !home.parent.isConnected;
}
