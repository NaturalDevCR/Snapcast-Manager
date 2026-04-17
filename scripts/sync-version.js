#!/usr/bin/env node
/**
 * Reads the version from client/package.json and syncs it to:
 *   - server/package.json
 *   - scripts/install.sh
 *
 * Run manually:  node scripts/sync-version.js
 * Run via npm:   cd client && npm version <patch|minor|major>
 *   (the "version" lifecycle hook in client/package.json calls this automatically)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const clientPkg = path.join(root, 'client', 'package.json');
const serverPkg = path.join(root, 'server', 'package.json');
const installSh = path.join(root, 'scripts', 'install.sh');

const { version } = JSON.parse(fs.readFileSync(clientPkg, 'utf8'));
console.log(`Syncing version v${version} across project...`);

// ── server/package.json ─────────────────────────────────────────────────────
const server = JSON.parse(fs.readFileSync(serverPkg, 'utf8'));
server.version = version;
fs.writeFileSync(serverPkg, JSON.stringify(server, null, 2) + '\n');
console.log(`  ✓ server/package.json → ${version}`);

// ── scripts/install.sh ──────────────────────────────────────────────────────
let sh = fs.readFileSync(installSh, 'utf8');
sh = sh.replace(/^VERSION="v[0-9]+\.[0-9]+\.[0-9]+"$/m, `VERSION="v${version}"`);
fs.writeFileSync(installSh, sh);
console.log(`  ✓ scripts/install.sh  → v${version}`);

console.log('Done.');
