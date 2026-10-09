export function scrubDocument(login: string, doc: Document = document): string {
  doc.querySelectorAll('script:not([type="application/json"]), noscript, iframe').forEach((e) => e.remove());
  doc.querySelectorAll('meta').forEach((m) => {
    const name = `${m.getAttribute('name') ?? ''} ${m.getAttribute('http-equiv') ?? ''}`;
    if (/csrf|token|nonce|request-id|visitor|octolytics|analytics|user-login|expected-hostname/i.test(name)) m.remove();
  });
  doc.querySelectorAll('input[type="hidden"]').forEach((i) => i.removeAttribute('value'));
  let html = `<!doctype html>\n${doc.documentElement.outerHTML}`;
  html = html.replace(/"(csrf[^"]*|authenticity_token|[a-zA-Z]*[Tt]oken)"\s*:\s*"[^"]*"/g, '"$1":"SCRUBBED"');
  if (login) html = html.split(login).join('fixture-user');
  return html;
}
