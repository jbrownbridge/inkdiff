// Background service worker: one job. chrome.storage.session (memory only, extension only, gone
// when the browser closes) is closed to content scripts by default; open it to them so the source
// cache can survive a reload without ever touching the page's own storage.
const openSessionStorage = () => chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

chrome.runtime.onInstalled.addListener(openSessionStorage);
chrome.runtime.onStartup.addListener(openSessionStorage);
void openSessionStorage();
