import { scrubDocument } from '../e2e/lib/scrub';

describe('scrubDocument', () => {
  it('removes tokens, executable scripts, and the login name', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.head.innerHTML = '<meta name="csrf-token" content="SECRET1"><meta name="user-login" content="octobot">';
    doc.body.innerHTML = [
      '<script>window.secret = "SECRET2"</script>',
      '<script type="application/json" data-target="react-app.embeddedData">{"headSha":"abc","user":"octobot"}</script>',
      '<form><input type="hidden" name="authenticity_token" value="SECRET3"></form>',
      '<a href="/octobot">octobot</a>',
    ].join('');
    const html = scrubDocument('octobot', doc);
    expect(html).not.toMatch(/SECRET[123]/);
    expect(html).not.toContain('octobot');
    expect(html).toContain('fixture-user');
    expect(html).toContain('"headSha":"abc"');
  });
});
