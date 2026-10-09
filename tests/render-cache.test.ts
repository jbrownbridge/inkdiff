import { renderFile } from '../src/content/render-cache';

const ref = (path: string, sha = 's1') => ({ repo: 'o/r', sha, path });

describe('renderFile', () => {
  it('reuses the render of the same source at the same commit', () => {
    const a = renderFile(ref('a.md'), '# Hi\n');
    expect(renderFile(ref('a.md'), '# Hi\n')).toBe(a);
    expect(renderFile(ref('a.md', 's2'), '# Hi\n')).not.toBe(a);
    expect(renderFile(ref('a.md'), '# Changed\n')).not.toBe(a);
  });

  it('renders .mmd files as one diagram', () => {
    expect(renderFile(ref('d.mmd'), 'graph TD\nA-->B\n').html).toContain('md-mermaid');
  });
});
