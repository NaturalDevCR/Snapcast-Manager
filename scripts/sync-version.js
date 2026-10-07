#!/usr/bin/env node
/**
 * Reads the version from the root package.json and syncs it to:
 *   - client/package.json  (read by the Vue frontend at build time)
 *   - server/package.json
 *   - scripts/install.sh
 *
 * Runs automatically via the "version" npm lifecycle hook.
 * To bump: npm version patch|minor|major  (from the repo root)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rootPkg   = path.join(root, 'package.json');
const clientPkg = path.join(root, 'client', 'package.json');
const serverPkg = path.join(root, 'server', 'package.json');
const installSh = path.join(root, 'scripts', 'install.sh');

const { version } = JSON.parse(fs.readFileSync(rootPkg, 'utf8'));
console.log(`Syncing version v${version} across project...`);

// ── client/package.json ─────────────────────────────────────────────────────
const client = JSON.parse(fs.readFileSync(clientPkg, 'utf8'));
client.version = version;
fs.writeFileSync(clientPkg, JSON.stringify(client, null, 2) + '\n');
console.log(`  ✓ client/package.json → ${version}`);

// ── server/package.json ─────────────────────────────────────────────────────
const server = JSON.parse(fs.readFileSync(serverPkg, 'utf8'));
server.version = version;
fs.writeFileSync(serverPkg, JSON.stringify(server, null, 2) + '\n');
console.log(`  ✓ server/package.json → ${version}`);

// ── scripts/install.sh ──────────────────────────────────────────────────────
let sh = fs.readFileSync(installSh, 'utf8');
// Leading whitespace allowed: the fallback line lives inside an if/else
// (SNAPCAST_MANAGER_VERSION override), so it is indented.
const versionLine = /^([ \t]*)VERSION="(?:v[0-9]+\.[0-9]+\.[0-9]+|\$\{LATEST_RELEASE:-v[0-9]+\.[0-9]+\.[0-9]+\})"$/m;
if (!versionLine.test(sh)) {
  console.error('  ✗ scripts/install.sh: VERSION fallback line not found -- update sync-version.js');
  process.exit(1);
}
sh = sh.replace(versionLine, (line, indent) => line.includes('LATEST_RELEASE')
  ? `${indent}VERSION="\${LATEST_RELEASE:-v${version}}"`
  : `${indent}VERSION="v${version}"`
);
fs.writeFileSync(installSh, sh);
console.log(`  ✓ scripts/install.sh  → v${version}`);

console.log('Done.');
