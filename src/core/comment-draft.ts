import type { LineRange } from './diff-map';

export interface DraftContext {
  repo: string;
  pr: number;
  path: string;
  headSha: string;
  lines: LineRange;
  source: string;
  selectedText?: string;
}

export interface DraftProvider {
  id: string;
  label: string;
  draft(ctx: DraftContext): Promise<string>;
}

const registry = new Map<string, DraftProvider>();

export function registerProvider(p: DraftProvider): void {
  registry.set(p.id, p);
}

export function getProviders(): DraftProvider[] {
  return [...registry.values()];
}

export function clearProviders(): void {
  registry.clear();
}

function sourceLines(ctx: DraftContext): string[] {
  return ctx.source.replace(/\r\n?/g, '\n').split('\n').slice(ctx.lines.start - 1, ctx.lines.end);
}

export const quoteProvider: DraftProvider = {
  id: 'quote',
  label: 'Quote',
  async draft(ctx) {
    const text = ctx.selectedText?.trim() ? ctx.selectedText.trim() : sourceLines(ctx).join('\n');
    return `${text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n`;
  },
};

export const suggestProvider: DraftProvider = {
  id: 'suggest',
  label: 'Suggest',
  async draft(ctx) {
    const body = sourceLines(ctx).join('\n');
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}suggestion\n${body}\n${fence}\n`;
  },
};

export function registerBuiltInProviders(): void {
  registerProvider(quoteProvider);
  registerProvider(suggestProvider);
}
