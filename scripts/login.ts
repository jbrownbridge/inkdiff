// Opens a browser window to sign in to GitHub once; the session stays in .auth/profile (git-ignored)
// for `npm run smoke` and the fixture capture scripts.
import { ensureLoggedIn } from '../e2e/lib/login';

await ensureLoggedIn('.auth/profile');
console.log('Signed in: .auth/profile is ready.');
