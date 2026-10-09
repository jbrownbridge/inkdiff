# Security

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Report privately, not in a public issue:

- through the repository's **Security → Report a vulnerability** form, or
- by email to **jason@loopright.com**.

Expect a first reply within 7 days.

Good-faith research is welcome: if you act in good faith, avoid harming users and their data, and give time for a fix before you disclose, the maintainer will not pursue legal action against you for that research.

## How Inkdiff is protected

[docs/security.md](docs/security.md) explains the design with diagrams: what runs where, how untrusted Markdown and Mermaid are rendered, how file sources are read, what is stored, and the kill switch.

Reports about these are especially welcome:

- a way for a pull request's Markdown or Mermaid to run script, load a file, or change GitHub's page outside the rendered view;
- a changed line that the rendered view hides;
- a way for a web page to read what Inkdiff stores.
