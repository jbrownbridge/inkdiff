export function button(doc: Document, className: string, text: string, title?: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  if (title) b.title = title;
  return b;
}

export function div(doc: Document, className: string, text?: string): HTMLDivElement {
  const d = doc.createElement('div');
  d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
