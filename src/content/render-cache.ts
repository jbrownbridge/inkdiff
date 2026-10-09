import type { SourceRef } from '../core/source-fetch';
import { fileKind } from '../github/types';
import { renderMermaidFile } from '../render/mermaid-file';
import { renderMarkdown, type RenderResult } from '../render/render';

/** Parsed files kept for reopening: GitHub re-creates file sections as they scroll in and out. */
const MAX_ENTRIES = 100;
const cache = new Map<string, { source: string; result: RenderResult }>();

/**
 * Render a file's source, or reuse the last render of the same source at the same commit. The
 * result is never mutated (the panel copies its HTML), so it is safe to share.
 */
export function renderFile(ref: SourceRef, source: string): RenderResult {
  const key = `${ref.repo}@${ref.sha}:${ref.path}`;
  const hit = cache.get(key);
  if (hit && hit.source === source) {
    cache.delete(key);
    cache.set(key, hit); // most recently used last
    return hit.result;
  }
  const result = fileKind(ref.path) === 'mermaid'
    ? renderMermaidFile(source)
    : renderMarkdown(source, { repo: ref.repo, headSha: ref.sha, path: ref.path });
  cache.set(key, { source, result });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return result;
}
