# Changelog

All notable changes to Snapcast Manager are documented in this file.

Generated from this repository's conventional-commit history with
[git-cliff](https://git-cliff.org/). Regenerated automatically as part of
each `release.yml` run (see .github/workflows/release.yml) -- do not hand
edit entries below; amend the source commit message instead and
regenerate.

## [0.3.2] - 2026-09-01

### 🐛 Bug Fixes

- *(install,security)* Auto-install missing sudo package + drop upgrade-insecure-requests CSP directive (v0.3.2) (#5)

### 📚 Documentation

- *(changelog)* Update CHANGELOG.md for v0.3.1
## [0.3.1] - 2026-09-01

### 🚀 Features

- *(server)* Add shell-free platform/exec.ts and platform/systemd.ts
- *(platform)* Add apt.ts + files.ts shell-free primitives
- *(system)* Migrate services/system.ts onto the shell-free platform layer (Task 11)
- *(ui)* Add Button/Input/Select/Toggle/Badge primitives + dev showcase (Task 21)
- *(ui)* Add Modal/ConfirmDestructive/EmptyState/Skeleton/SectionHeader primitives (Task 22)
- *(shared,server,client)* Shared types dir + Zod validation middleware (Task 23)
- *(server)* Atomic config writes + versioned migrations + persistent jobs (Task 24)
- *(server)* Persistent snapserver WS client + SSE events endpoint (Task 25)
- *(server)* Watchdog timer on-demand, /proc zombie detection, pipe-source slug collision guard (Task 26)
- *(server)* Structured pino logging + graceful shutdown (Task 27)
- SSE ticket-based auth (backend) + client EventSource wrapper (Task 28)
- *(client)* Wire Dashboard.vue and Routing.vue onto SSE, remove polling (Task 29)
- *(client)* Reorganize nav into four task-based groups (Task 30)
- *(client)* Replace native confirm() with ConfirmDestructive/ConfirmDialog (Task 31)
- *(client)* Add aria-label to icon-only buttons (Task 32)
- *(client)* Adopt EmptyState.vue for ad-hoc empty states (Task 33)
- *(client)* Accessible keyboard alternative for Audio Matrix routing (Task 34)
- *(client)* Adopt Skeleton.vue for initial-content loading states (Task 35)
- *(client)* Enlarge icon-only button touch targets to >=40px (Task 36)
- *(client)* Extract Snapshots tab into SnapshotsPanel.vue (Task 38)
- *(client)* Extract Logs modal into LogsModal.vue (Task 39)
- *(client)* Extract Import Existing modal into ImportModal.vue (Task 40)
- *(client)* Extract Config Editor modal into ConfigEditorModal.vue (Task 41)
- *(client)* Extract Add/Edit Pipe dialog into AddEditPipeDialog.vue (Task 42)
- *(client)* Extract Add/Edit Source dialog into AddEditSourceDialog.vue (Task 43)
- *(client)* Extract Standard tab into StandardTab.vue (Task 44)
- *(client)* Extract Expert tab into ExpertTab.vue (Task 45)
- *(server)* Add onboarding progress persistence (migration 7 + endpoints)
- *(client)* Add onboarding Pinia store
- *(client)* Add onboarding wizard steps 1-2 (install snapserver, add first source)
- *(client)* Add onboarding wizard step 3 (assign first zone) and Dashboard resume banner
- *(client)* Add vue-i18n infrastructure (EN/ES) (Task 51)
- *(client)* Add EN/ES language switcher to Layout.vue (Task 52)
- *(client)* Extract Login.vue strings to EN/ES (i18n pilot, Task 53)
- *(client)* Extract Setup.vue strings to EN/ES (Task 54)
- *(client)* Extract Onboarding.vue strings to EN/ES (Task 55)
- *(client)* Extract Dashboard.vue strings to EN/ES (Task 56)
- *(server)* Add health check endpoints (Stage 5, item 5.1)
- *(client)* Health check UI panel (Stage 5, item 5.1 frontend)
- *(server)* Real, component-aware backup snapshots (Task 60)
- *(server)* Verify GitHub download size/hash before dpkg -i (Task 61)
- *(server)* Self-diagnostics backend (Task 62, Stage 5, item 5.5 pt 1/2)
- *(client)* Self-diagnostics UI (Task 63, Stage 5 item 5.5 part 2/2)
- *(server)* Local metrics -- uptime, jobs executed, errors per endpoint (Task 64)
- Container-based integration tests (Stage 5, item 5.6)
- *(i18n)* Extract Logs + Security view strings to en/es namespaces (Task 70)
- *(i18n)* Extract Diagnostics + Watchdogs view strings to en/es namespaces (Task 71)
- *(i18n)* Extract ServerConfig + PipeSources view strings to en/es namespaces (Task 72)
- *(i18n)* Extract ClientDashboard + Tools view strings to en/es namespaces (Task 73)
- *(i18n)* Extract Routing view strings to en/es namespaces (Task 74)
- *(release)* Reproducible releases -- checksums, CHANGELOG.md, install.sh hash verify (Task 75)

### 🐛 Bug Fixes

- *(server)* Restore never-sudo activeState()/isActive() in systemd.ts
- *(apt)* Make isInstalled() actually distinguish spawn failure from not-installed
- *(security)* Close existingServiceName command injection, migrate pipeSources to platform layer
- *(pipeSources)* Reorder mpd FIFO migration to write-before-remove
- *(security)* Close snapclientInstances :id command injection, migrate to platform layer
- *(tools)* Create MANAGED_SCRIPTS_DIR on registration
- *(system)* Restore incremental job-progress logging in install/update/uninstall
- *(client)* Repair broken Tailwind v4 token system + CI regression guard (Task 18)
- *(client)* Theme init on all routes + audit hardcoded dark-only colors (Task 19)
- *(server)* Enforce schema<->type correspondence for update/control schemas (Task 23 review fix)
- *(server)* Route snapserver.conf/.base/.bak writes through installPrivilegedFile (Task 24 review fix)
- *(server)* Validate notification substructure before cache merge (Task 25 review fix)
- *(server)* Reject update() rename that collides with a different pipe source's slug (Task 26 review fix)
- *(server)* Silence pino logs during npm test (Task 27 review fix)
- *(client)* Repair low-contrast text colors per WCAG 1.4.3 audit (Task 37)
- *(client)* Review-driven fixes for WCAG contrast Task 37
- *(client)* Review-driven fixes for Task 44 (sectionOrder dedup, dead eslint-disable)
- *(client)* Add real keyboard accessibility to raw Teleport modals (Task 46)
- *(client)* Close firstGroupWithClient test-coverage gap (Task 50 review fix)
- *(client)* Bump vue-i18n 10.0.8 -> ^11 (review-driven fix, Task 51)
- *(client)* Register layout i18n namespace on the real i18n singleton (Task 52 review fix)
- *(client)* Stop real i18n singleton locale from leaking across tests (Task 53 fix pass)
- *(server)* Seed real user for health.test.ts auth (Task 57 fix, review-driven)
- *(server)* Safe install/update -- real backup blocking + auto-rollback (Task 59)
- *(server)* Honest rollback messaging + coverage gaps (Task 59 review fix)
- *(server)* Reattach misplaced JSDoc after Task 61 review
- *(server)* Close 2 real gaps in diagnostics found by Task 62 review
- *(client)* Close 2 real gaps in diagnostics UI found by Task 63 review
- *(server)* Close unbounded-Map-growth gap in error-per-endpoint metrics
- *(install)* Pre-create /etc/mpd.conf + /var/lib/mpd for ReadWritePaths
- *(install)* Pre-create every ReadWritePaths= target, not just mpd.conf
- *(install)* Add missing /etc/snapserver.conf.bak to ReadWritePaths
- *(install)* Remove NoNewPrivileges=yes -- it breaks sudo entirely
- *(test)* Probe with a granted sudoers command, not 'sudo -n true'
- *(docs)* Correct production DB path in README's Architecture section
- *(docs)* Use the exact --value flag in troubleshooting.md's sudo-verify command
- *(i18n)* Keep 'Manager' untranslated in logs.json's ES tab label
- *(i18n)* Remove erroneous 'Server' bleed-in from watchdogs.json ES
- *(i18n)* Correct 2 mistranslated strings in routing.json ES
- *(ci)* Make no-shell-injection gate fail the build
- *(install)* RuntimeDirectory= for /run/snapcast-manager, survive reboot
- *(security)* Missing tar sudoers grant + real package-install sandbox fixes (Task 66, v0.3.1) (#4)

### 💼 Other

- *(assets)* Self-host Inter + Material Symbols fonts, real favicon/manifest, prefers-reduced-motion (Task 20)

### 🛡️ Security

- *(pipe-sources)* Move FIFOs from /tmp to /run/snapcast-manager (Task 7)
- *(tools)* Close arbitrary-file-write-as-root via managed script dir
- *(backup)* Migrate services/backup.ts to platform/exec.ts (Task 10)
- *(system)* Migrate services/system.ts's download/build/install pipelines onto the platform layer (Task 12)
- *(system)* Restore per-line privilege separation in install-shairport-sync.sh
- *(watchdog)* Migrate services/watchdog.ts onto the shell-free platform layer (Task 13)
- *(pipeSources)* Harden PUT /:id/config with verify, section allowlist, backup+rollback
- *(auth)* Password policy, persisted rate limiting, security headers, token invalidation, logout (Task 15)
- *(install)* Dedicated snapmanager user, sudoers.d, systemd hardening, migration (Task 16)
- *(sudoers)* Fix critical/important findings from task 16 review
- *(system)* Replace updateNodeJs()'s curl|bash with NodeSource APT-repo method (Task 17)

### 📚 Documentation

- Add professional hardening spec and plan
- Add LICENSE, CONTRIBUTING, SECURITY, and GitHub templates
- Add onboarding wizard design spec (Stage 4 item 4.7)
- Add onboarding wizard implementation plan
- Add i18n design spec (Stage 4 item 4.9)
- Add i18n implementation plan
- *(readme,installation)* Rewrite README + add docs/installation.md (Task 66)
- *(troubleshooting)* Add symptom-organized troubleshooting guide (Task 67)
- *(api)* Add full HTTP API reference (Task 68)
- *(deployment)* Add secure deployment guide (Task 69)

### 🎨 Styling

- *(i18n)* Swap mild anglicism 'removido' for 'quitado' in pipeSources.json ES

### 🧪 Testing

- *(client)* Add Vitest + one smoke test per view

### ⚙️ Miscellaneous Tasks

- Add CI workflow, root ESLint/Prettier, anti-injection grep check
- Register container integration test workflow for dispatch (Task 65)
## [0.3.0] - 2026-07-13

### 🚀 Features

- Add myMPD management and player integration (#3)
## [0.2.2] - 2026-07-12

### 🐛 Bug Fixes

- Detect snap-ctrl version with new dist-only release format

### ⚙️ Miscellaneous Tasks

- Bump version to v0.2.2
## [0.2.1] - 2026-07-12

### 🐛 Bug Fixes

- Snap-ctrl doc_root update no longer resets snapserver.conf
- Pipe-source changes no longer reset snapserver.conf; add config-edit tests

### ⚙️ Miscellaneous Tasks

- Bump version to v0.2.1
## [0.2.0] - 2026-07-11

### 🐛 Bug Fixes

- Harden security, add background jobs, backups UI, and cleanup

### 📚 Documentation

- Warn against committing the runtime database

### ⚙️ Miscellaneous Tasks

- Bump version to v0.2.0
## [0.1.20] - 2026-06-12

### 🐛 Bug Fixes

- Prevent snap-ctrl update from overwriting config data

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.20
## [0.1.19] - 2026-05-19

### 🐛 Bug Fixes

- Regenerate pipe source services
## [0.1.18] - 2026-05-19

### 🚀 Features

- Add service file editor and rename support to Pipe Sources

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.18
## [0.1.17] - 2026-05-19

### 🚀 Features

- Generalize Radio Streams into multi-type Pipe Sources (Radio + MPD)

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.17
## [0.1.16] - 2026-05-19

### 🐛 Bug Fixes

- Fetch latest release version dynamically in install.sh; silence Node.js 20 deprecation in CI

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.16
## [0.1.15] - 2026-05-19

### 🚀 Features

- Expose ffmpeg reconnect flags as form fields in Internet Radio source editor
- Add Radio Stream Services — managed ffmpeg radio streams via systemd

### 🐛 Bug Fixes

- Resolve CI TypeScript errors in RadioStreams.vue
## [0.1.14] - 2026-04-17

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.14
## [0.1.13] - 2026-04-17

### 🐛 Bug Fixes

- Resolve all npm audit vulnerabilities in client and server

### ⚙️ Miscellaneous Tasks

- Remove vite-plugin-pwa (unused in admin dashboard)
- Bump version to v0.1.13
## [0.1.10] - 2026-04-17

### ⚙️ Miscellaneous Tasks

- Bump install.sh version to v0.1.9
- Unify version management — single source of truth in client/package.json
- Bump to v0.1.10 and finalize version management
## [0.1.9] - 2026-04-17

### 🚀 Features

- Add MPD management, Tools view (crontab/script editor), and fix dropdown transparency
## [0.1.8] - 2026-04-04

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.8
## [0.1.7] - 2026-04-04

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.7 and fix bashism in shairport sync install
## [0.1.6] - 2026-04-04

### 🚀 Features

- Implement dynamic theme for snapclient and snapserver modes
## [0.1.5] - 2026-04-04

### 🐛 Bug Fixes

- ALSA route collision, DB backup/restore, and add NODE_ENV=production to .env
## [0.1.4] - 2026-04-04

### 🐛 Bug Fixes

- Resolve TypeScript build errors in ClientDashboard ALSA functions
## [0.1.3] - 2026-04-04

### 🚀 Features

- Fix snapclient instance identity, add ALSA mixer UI, and installation mode selection
## [0.1.2] - 2026-04-04

### 🐛 Bug Fixes

- Show internal audio devices and filter HDMI in snapclient modal, bump v0.1.2
## [0.1.1] - 2026-04-04

### 🚀 Features

- Dynamic sudo detection, installation mode selection, bump v0.1.1
## [0.1.0] - 2026-03-19

### ⚙️ Miscellaneous Tasks

- Bump version to v0.1.0 and update README features
## [0.0.10] - 2026-03-18

### 🚀 Features

- *(ui)* Security as standalone page, fix client logs mode, bump v0.0.10

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.10 in install script and Dashboard UI
## [0.0.9] - 2026-03-18

### 🚀 Features

- *(ui+api)* Navigation overhaul, zone rename, and client log filtering

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.9
- Bump version to v0.0.9 and fix undefined access in Logs.vue
## [0.0.8] - 2026-03-18

### 🚀 Features

- *(ui)* Redesign navbar and configuration tab navigation

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.8 and ignore .claude
## [0.0.7] - 2026-03-18

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.7
## [0.0.5] - 2026-03-18

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.5
## [0.0.4] - 2026-03-18

### 🐛 Bug Fixes

- *(system)* Enhance err reporting in getServiceLogs and fallback to non-sudo journalctl

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.4
## [0.0.3] - 2026-03-18

### 🐛 Bug Fixes

- Sudo handling in Node.js installation

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.3
## [0.0.2] - 2026-03-18

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.2
## [0.0.1] - 2026-03-18

### 🚀 Features

- Installation script, README, and github actions release flow
- *(installer)* Add reinstall capability handling previous installation and systemd service cleanup
- *(installer)* Support interactivity when piped via /dev/tty and add -y flag for auto-confirm
- *(installer)* Display version in header and finalize Express 5 routing
- Integrate snap-ctrl and shairport-sync, remove snapclient management (v0.1.0)
- V0.1.3 - Config Editor, Logs Tab, and Bug Fixes
- V0.1.4 - Enhanced Config UI and Versioning transparency
- V0.1.5 - Robust updates for Snapserver/snap-ctrl via GitHub and Node.js update support
- Structured configuration UI with metadata, custom dialogs, and reset functionality (v0.1.11)
- *(ui)* Complete configuration UI rework with source templates and tabs
- *(ui)* Pre-populate all config properties with enable/disable toggles, remove unused segments
- *(sources)* Add FFmpeg Internet Radio template, enhance TCP/AirPlay/Meta/Process with production params
- *(ui)* Source name labels, default_source dropdown, ordered config with source comments
- *(ui)* Split stream tab into visual subsections for sources and settings
- Dashboard Redesign with live Snapcast RPC metrics
- *(installer)* Add CLI UI colors, dynamic web port, and local IP detection
- *(ui)* Redesign ServerConfig and UI components to Stitch aesthetic
- *(ui)* Redesign Dashboard to match Stitch style
- *(ui)* Redesign Logs, Login and Setup views to match Stitch
- *(system)* Install shairport-sync and nqptp from source for AirPlay 2
- *(system)* Add uninstallPackage for shairport-sync
- Enhance raw editor and bump version to 0.1.43
- Enhance Raw Editor and bump version to 0.1.50
- Add light/dark theme switcher and fix navbar centering
- Bump version to 0.1.51
- Bump version to 0.1.52
- TCP Watchdog implementation and version bump to 0.1.54
- *(routing)* Interactive audio matrix with animated SVG cables (v0.1.65)

### 🐛 Bug Fixes

- Make install.sh work when piped from curl by auto-answering and downloading release zip
- *(installer)* Systemd WorkingDirectory was resolving incorrectly when installing from release zip
- Express 5 catch-all route syntax and improve installer robustness
- Express 5 catch-all route syntax and improve installer
- *(installer)* Corrected syntax error in install.sh
- Use path-less middleware for SPA fallback to avoid Express 5 PathError
- *(client)* Page content empty after login due to missing slot in Layout
- Installer versioning, main branch source, and database preservation (v0.1.1)
- Snap-ctrl installation, UX improvements (pointer, loading), and resource versions (v0.1.1.1)
- V0.1.4 TS build error in ServerConfig.vue
- Resolve bash syntax error in install.sh and bump version to v0.1.9
- *(config)* Terminate template literal in defaultConfig.ts (v0.1.12)
- *(client)* Headlessui dep and backtick escaping (v0.1.13)
- *(ci)* Remove unused var and update action node version
- *(build)* Use tsc -p for TS 5.9 compat, bump v0.1.20
- *(install)* Correct pre-built detection paths in install.sh
- *(install)* Use INSTALL_BASE_DIR for service WorkingDirectory to avoid doubled path
- Use HTTP Protocol for JSON-RPC in dashboard metrics
- *(install)* Remove broken ascii art
- *(nav)* Remove redundant Streams and Expert menu links
- *(install)* Initialize REPO_ZIP_URL and use tag archive fallback
- *(git)* Remove accidental sensitive files and update .gitignore
- *(install)* Remove duplicate VERSION variable
- *(system)* Use absolute path to shairport-sync for version check
- *(system)* Manually copy nqptp.service to systemd before enabling
- *(system)* Align shairport & nqptp builds with V5 requirements
- *(git)* Remove accidentally committed nqptp-inspect submodule
- *(system)* Add systemd-dev as optional build dependency for shairport
- *(system)* Purge old apt/source shairport installations before compiling
- *(system)* Hook installPackage to custom shairport-sync build method
- *(system)* Decouple user and group checks for shairport to avoid groupadd collisions
- Recreate editor on tab mount and switch to tomorrow theme
- Remove height from raw editor container and hide light/dark toggle
- Bump Dashboard version to 0.1.54
- Remove leftover librespot references from Dashboard.vue
- *(installer)* Correct SUDO detection logic

### 💼 Other

- Modular configuration, Clean Reinstall, and snap-ctrl path fix

### 📚 Documentation

- Rewrite README.md with all features and PayPal donation link
- Use correct PayPal link

### ⚡ Performance

- Fetch prebuilt release via install.sh to speed up installation (v0.1.14)
- Backend cache and unified frontend dashboard endpoint to fix sluggish UI (v0.1.15)

### 🎨 Styling

- *(client)* Revert to standard textarea for raw config and fix(server): silence periodic status logs
- Fix raw editor background to match theme frame
- Make raw editor background transparent
- Fix responsive layout for ServerConfig tabs and action footer
- Fit desktop tabs and center standard save button

### ⚙️ Miscellaneous Tasks

- Bump version to v0.0.7 and include version in installer header
- Bump version to v0.1.2
- Release v0.1.6 - full UI/UX overhaul and toast system
- Release v0.1.7 - robust Snapserver updates and Node.js LTS selector
- Release v0.1.8 - fix Snapserver permission issue and upgrade installer
- *(release)* Bump all versions to v0.1.18 including hardcoded strings
- Bump version to v0.1.28, add export/import, password reset, login fix, and UI tweaks
- Update web app HTML title to Snapcast Manager
- *(release)* Bump version to 0.1.31 across all files
- Bump version to 0.1.33
- Bump version to 0.1.34 - fix node version display
- Update install script with ASCII art and Update flow
- Allow force re-install item selections
- Bump version to 0.1.37 everywhere
- Fix installer read issue in piped shells & bump to 0.1.38
- Bump version to 0.1.39 and fix UI items
- Bump version to 0.1.47 & added mobile navigation drawer
- Bump version to 0.1.48 (fix UI/install script) & Node 22 upgrade
- Bump version to 0.1.49
- Apply custom logo asset to UI layout and login panels
- Bump version to v0.1.59 and remove MPD integration
- Bump version to v0.1.60 and UI overhaul
- Bump version to v0.1.61 and refine UI aesthetics
- Bump version to v0.1.62 and finalize UI refinements
- *(release)* V0.1.63 - UI redesign and stream fix
- *(ui)* Restore previous lighter purple theme
- Bump version to v0.1.66
- Reset versioning to v0.0.1 and purge previous release history
