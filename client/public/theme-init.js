// Theme init -- must run synchronously, before any CSS paints and before
// Vue mounts (see index.html for the full "why" and the two symptoms this
// avoids). Logic must mirror useUIStore's `isDark` default exactly
// (localStorage 'theme' !== 'light' => dark) or the two would fall out of
// sync on first load.
//
// v0.3.8 fix (real bug, found live): this used to be an INLINE <script> in
// index.html. server/src/index.ts's helmet CSP sets `script-src 'self'`
// (helmet's own default, never widened here) with no 'unsafe-inline'/nonce
// -- browsers silently block inline <script> tags under that policy (see
// console: "Executing inline script violates the following Content
// Security Policy directive 'script-src 'self''"). So on every real
// deployment (this app is always served through the Node/Express server in
// production, index.html is never opened as a bare file) this script
// NEVER RAN: the pre-mount class stayed whatever the static HTML shipped,
// regardless of what was in localStorage, on every single page load --
// exactly the "theme doesn't persist" symptom reported, and unrelated to
// (on top of) the separate transition-lag bug fixed in v0.3.7. An external
// same-origin script tag (this file, referenced via `<script src=
// "/theme-init.js">`) is covered by `script-src 'self'` with no CSP change
// needed -- safer than adding 'unsafe-inline' or wiring up a nonce for a
// single tiny script.
(function () {
  try {
    var isDark = localStorage.getItem('theme') !== 'light';
    document.documentElement.classList.toggle('dark', isDark);
  } catch (e) {
    // localStorage unavailable (e.g. private mode edge cases) - default to dark.
    document.documentElement.classList.add('dark');
  }
})();
