// Page-world content script (manifest "world": "MAIN"), injected at document_start before React runs.
import { markEarly } from './early';
import { installHostedPatch } from './hosted-patch';

installHostedPatch(window);
markEarly(document, (() => { try { return window.localStorage; } catch { return null; } })());
