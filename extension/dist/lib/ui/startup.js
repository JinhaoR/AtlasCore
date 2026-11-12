import { atlasPage } from './navigation-state.js';
// Parser-time presentation only: select the correct shell before the larger UI
// bundle starts. No stored state, browser requests, listeners or authorization.
const requested = atlasPage(location.hash.slice(1)) ?? (new URL(location.href).searchParams.get('view') === 'access' ? 'access' : 'home');
const page = requested === 'access' ? 'home' : requested;
document.body.dataset.page = page;
document.body.dataset.section = page === 'vault' ? 'settings' : page;
document.body.dataset.mode = 'control';
