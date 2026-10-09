export type FormatKind = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol' | 'task' | 'mention' | 'reference';
export interface Edit { value: string; start: number; end: number }

function replace(value: string, start: number, end: number, text: string, selStart: number, selEnd: number): Edit {
  return { value: value.slice(0, start) + text + value.slice(end), start: start + selStart, end: start + selEnd };
}

function wrap(value: string, start: number, end: number, open: string, close: string): Edit {
  const sel = value.slice(start, end);
  return replace(value, start, end, open + sel + close, open.length, open.length + sel.length);
}

function prefixLines(value: string, start: number, end: number, prefix: (i: number) => string): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends right after a newline does not touch the next line.
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', last);
  const to = nl === -1 ? value.length : nl;
  const text = value.slice(from, to).split('\n').map((l, i) => prefix(i) + l).join('\n');
  return replace(value, from, to, text, 0, text.length);
}

export function formatText(value: string, start: number, end: number, kind: FormatKind): Edit {
  switch (kind) {
    case 'bold': return wrap(value, start, end, '**', '**');
    case 'italic': return wrap(value, start, end, '_', '_');
    case 'code': return value.slice(start, end).includes('\n') ? wrap(value, start, end, '```\n', '\n```') : wrap(value, start, end, '`', '`');
    case 'link': {
      const sel = value.slice(start, end);
      const text = `[${sel}](url)`;
      return replace(value, start, end, text, sel.length + 3, sel.length + 6);
    }
    case 'heading': return prefixLines(value, start, end, () => '### ');
    case 'quote': return prefixLines(value, start, end, () => '> ');
    case 'ul': return prefixLines(value, start, end, () => '- ');
    case 'task': return prefixLines(value, start, end, () => '- [ ] ');
    case 'ol': return prefixLines(value, start, end, (i) => `${i + 1}. `);
    case 'mention': return replace(value, start, end, '@', 1, 1);
    case 'reference': return replace(value, start, end, '#', 1, 1);
  }
}
