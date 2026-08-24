import fs from 'fs/promises';
import path from 'path';

import { SnapConfigParser, SnapServerConfig } from '../utils/snapConfigParser';
import {
  surgicallySetIniKey,
  surgicallyAddStreamSource,
  surgicallyRemoveStreamSourcesByFifo,
} from '../utils/snapConfigEdit';
import { DEFAULT_SNAPSERVER_CONF } from '../constants/defaultConfig';
import { writeFileAtomic, installPrivilegedFile } from '../platform/files';
import { KeyedMutex } from '../platform/mutex';

// Default locations on Debian. Overridable via env var so tests can point
// at a throwaway directory instead of the real /etc paths (this process
// has no permission to write there outside a real install anyway) -- same
// env-override-at-module-load pattern database.ts uses for DB_PATH.
const SNAPSERVER_CONFIG_PATH = process.env.SNAPSERVER_CONFIG_PATH || '/etc/snapserver.conf';
const SNAPSERVER_CONFIG_BASE = process.env.SNAPSERVER_CONFIG_BASE || '/etc/snapserver.conf.base';
const SNAPSERVER_CONFIG_DIR = process.env.SNAPSERVER_CONFIG_DIR || '/etc/snapserver.conf.d';
// Single-slot backup of the master config, overwritten (not accumulated)
// on every write -- see writeServerConfigCore()'s rotateMasterBak().
const SNAPSERVER_CONFIG_BAK = `${SNAPSERVER_CONFIG_PATH}.bak`;

// A conventional, readable-by-everyone mode for these config files,
// asserted explicitly on every write. Plain in-place `fs.writeFile` (the
// old code) preserved whatever mode the file already had forever, because
// truncate-in-place never touches an inode's mode bits. Both
// `writeFileAtomic` (rename of a fresh inode) and `installPrivilegedFile`
// (sudo `cp` + a separate sudo `chmod`) can otherwise leave the file's mode
// tracking the writing process's/umask's default instead of staying fixed
// -- pinning it here keeps behavior equivalent to (and no less predictable
// than) the old code's steady state on a real install (created via `touch`
// + the default 022 umask in scripts/install.sh, i.e. already 644).
const CONFIG_FILE_MODE = 0o644;

// All config-mutating public methods below serialize on this ONE key (not
// one key per file) -- see platform/mutex.ts for the primitive. A single
// key, rather than a separate lock per file, is deliberate: nearly every
// mutation here touches BOTH the live master (/etc/snapserver.conf) and
// the modular base (.base) file within the same logical operation (e.g.
// addStreamSource() edits master then calls syncBaseInPlace() to mirror
// the edit into base) -- locking master and base independently would only
// prevent same-file interleaving, not master-and-base drifting relative to
// each other under concurrent requests. Config writes are rare (human- or
// install-triggered, never a hot path), so serializing the whole subsystem
// behind one key costs nothing in practice.
const CONFIG_LOCK_KEY = 'snapserver-config';

// `/etc/snapserver.conf`, `.base`, and `.bak` are written via
// `installPrivilegedFile()` (sudo-elevated `cp`/`chmod`), NOT
// `writeFileAtomic()` -- see the review fix in this file's git history for
// the full writeup. `writeFileAtomic()` creates its temp file in the SAME
// DIRECTORY as the destination and then `rename()`s it into place; both
// steps need write permission on the CONTAINING DIRECTORY (/etc), not just
// on the destination file itself. `scripts/install.sh` `chown`s these three
// files INDIVIDUALLY to `snapmanager:snapmanager` but deliberately leaves
// `/etc` itself root-owned (see install.sh's own comment above its `chown`
// loop for these paths) -- so on a real install, every `writeFileAtomic()`
// call against one of these three paths would fail with `EACCES` trying to
// create its temp file. `installPrivilegedFile()` sidesteps this entirely:
// it stages content in a private `mkdtemp` scratch directory the process
// fully owns, then does `sudo cp`/`sudo chmod` into the destination -- sudo
// (root) can write into /etc regardless of the directory's own permissions.
// `cp` overwriting an EXISTING destination file opens and truncates that
// file's existing inode rather than unlinking/recreating it (confirmed
// empirically -- same inode number before/after `cp` onto an existing
// destination), so this does NOT reset these files back to root-owned
// after each write; they stay `snapmanager`-owned exactly as install.sh
// left them.
//
// The segment-file write below (SNAPSERVER_CONFIG_DIR, .conf files under
// /etc/snapserver.conf.d/) is UNCHANGED -- install.sh `chown -R`s that
// directory itself (not just the files in it) to `snapmanager`, so the
// process genuinely has write permission on the containing directory and
// `writeFileAtomic()` is correct there.

export class ConfigService {
  private mutex = new KeyedMutex();

  async readServerConfig(): Promise<string> {
    try {
      await fs.access(SNAPSERVER_CONFIG_PATH);
      return await fs.readFile(SNAPSERVER_CONFIG_PATH, 'utf-8');
    } catch (error) {
     console.warn(`Could not read ${SNAPSERVER_CONFIG_PATH}, returning empty.`);
     return '';
    }
  }

  async readServerConfigParsed(): Promise<SnapServerConfig> {
    const raw = await this.readServerConfig();
    return SnapConfigParser.parse(raw);
  }

  async writeServerConfigParsed(config: SnapServerConfig): Promise<void> {
    const raw = SnapConfigParser.stringify(config);
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.writeServerConfigCore(raw));
  }

  async writeServerConfig(content: string): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.writeServerConfigCore(content));
  }

  /**
   * Validate, `.bak`-rotate, then write `content` as the new master config
   * via `installPrivilegedFile()` (sudo-elevated `cp`/`chmod` -- see the
   * top-of-file comment on why this can't be plain `writeFileAtomic()`).
   * This is the ONE place every write to SNAPSERVER_CONFIG_PATH funnels
   * through (directly here, or via rebuildMasterConfigCore()), so
   * validation and backup apply uniformly regardless of which public
   * method triggered the write.
   *
   * Caller MUST already hold CONFIG_LOCK_KEY -- this method does not lock
   * itself, so it's safe to call from other already-locked Core methods
   * without deadlocking on a non-reentrant mutex.
   */
  private async writeServerConfigCore(content: string): Promise<void> {
    this.assertParseable(content);
    await this.rotateMasterBak();
    await installPrivilegedFile(SNAPSERVER_CONFIG_PATH, content, { mode: CONFIG_FILE_MODE });
  }

  /**
   * `SnapConfigParser.parse()` is deliberately lenient: it silently skips
   * any line that isn't a `[section]` header or a `key = value` pair
   * inside one, and NEVER throws, even on completely non-INI input (a JSON
   * dump, an HTML error page, `[object Object]`, binary garbage) -- it just
   * returns however many sections it managed to recognize, `{}` if none.
   * So "parse and reject on throw" (the brief's original phrasing) would
   * never actually reject anything with this parser.
   *
   * The meaningful equivalent enforced here: content that isn't empty but
   * contains not even ONE recognizable `[section]` header is almost
   * certainly not real snapserver.conf content (every real config --
   * DEFAULT_SNAPSERVER_CONF, any base/segment file that's ever been
   * legitimately written -- has at least a [server] or [stream] section).
   * This catches the failure mode the brief is worried about (some other
   * bug in the app handing this method a non-config string) without
   * rejecting anything a real config write would ever produce.
   *
   * Empty content is likewise rejected (parses to zero sections too) --
   * writing a totally empty file over the live master config that
   * snapserver actually reads is never a legitimate outcome of any current
   * caller, and treating "empty" as just another shape of "not real
   * config" keeps this single rule easy to reason about instead of
   * special-casing it.
   */
  private assertParseable(content: string): void {
    const parsed = SnapConfigParser.parse(content);
    if (Object.keys(parsed).length === 0) {
      throw new Error(
        'Refusing to write snapserver.conf: the new content has no recognizable [section] ' +
          'structure (SnapConfigParser found zero sections). This usually means a bug ' +
          'elsewhere produced non-config content instead of real snapserver.conf text.',
      );
    }
  }

  /**
   * Copy whatever is CURRENTLY on disk at SNAPSERVER_CONFIG_PATH to
   * SNAPSERVER_CONFIG_BAK before it gets overwritten -- single slot,
   * overwritten every call, not a numbered history. Best-effort: if there
   * is no existing master config yet (fresh install, first-ever write),
   * there's nothing to preserve and that's not an error.
   */
  private async rotateMasterBak(): Promise<void> {
    let current: string;
    try {
      current = await fs.readFile(SNAPSERVER_CONFIG_PATH, 'utf-8');
    } catch {
      return;
    }
    await installPrivilegedFile(SNAPSERVER_CONFIG_BAK, current, { mode: CONFIG_FILE_MODE });
  }

  async ensureModularStructure(): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.ensureModularStructureCore());
  }

  private async ensureModularStructureCore(): Promise<void> {
    try {
      await fs.mkdir(SNAPSERVER_CONFIG_DIR, { recursive: true });

      try {
        await fs.access(SNAPSERVER_CONFIG_BASE);
      } catch (e) {
        // Migrate current config to base if base doesn't exist
        console.log(`Migrating ${SNAPSERVER_CONFIG_PATH} to ${SNAPSERVER_CONFIG_BASE}...`);
        const current = await this.readServerConfig();
        if (current && current.length > 50) { // arbitrary length to avoid migrating empty/broken files
          await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, current, { mode: CONFIG_FILE_MODE });
        } else {
          await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, DEFAULT_SNAPSERVER_CONF, { mode: CONFIG_FILE_MODE });
        }
      }
    } catch (error) {
      console.error('Failed to ensure modular structure:', error);
    }
  }

  async rebuildMasterConfig(): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.rebuildMasterConfigCore());
  }

  private async rebuildMasterConfigCore(): Promise<void> {
    await this.ensureModularStructureCore();

    let masterContent = '###############################################################################\n';
    masterContent += '# WARNING: THIS FILE IS AUTOMATICALLY GENERATED BY SNAPCAST MANAGER\n';
    masterContent += `# ANY MANUAL CHANGES WILL BE OVERWRITTEN. EDIT ${SNAPSERVER_CONFIG_BASE} OR SEGMENTS IN ${SNAPSERVER_CONFIG_DIR}\n`;
    masterContent += '###############################################################################\n\n';

    // 1. Read Base
    try {
      const base = await fs.readFile(SNAPSERVER_CONFIG_BASE, 'utf-8');
      masterContent += '### START BASE CONFIGURATION ###\n';
      masterContent += base;
      masterContent += '\n### END BASE CONFIGURATION ###\n\n';
    } catch (e) {
      masterContent += '# Error reading base configuration\n\n';
    }

    // 2. Read Segments
    try {
      const files = await fs.readdir(SNAPSERVER_CONFIG_DIR);
      const confFiles = files.filter(f => f.endsWith('.conf')).sort();

      for (const file of confFiles) {
        const content = await fs.readFile(path.join(SNAPSERVER_CONFIG_DIR, file), 'utf-8');
        masterContent += `### START SEGMENT: ${file} ###\n`;
        masterContent += content;
        masterContent += `\n### END SEGMENT: ${file} ###\n\n`;
      }
    } catch (e) {
      console.error('Error reading configuration segments:', e);
    }

    await this.writeServerConfigCore(masterContent);
  }

  async getSegments(): Promise<{name: string, content: string}[]> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.getSegmentsCore());
  }

  private async getSegmentsCore(): Promise<{name: string, content: string}[]> {
    await this.ensureModularStructureCore();
    const segments: {name: string, content: string}[] = [];
    try {
      const files = await fs.readdir(SNAPSERVER_CONFIG_DIR);
      const confFiles = files.filter(f => f.endsWith('.conf')).sort();

      for (const file of confFiles) {
        const content = await fs.readFile(path.join(SNAPSERVER_CONFIG_DIR, file), 'utf-8');
        segments.push({ name: file, content });
      }
    } catch (e) {
      console.error('Error listing segments:', e);
    }
    return segments;
  }

  /** Segment names come from HTTP params — never let them escape the config dir. */
  private sanitizeSegmentName(name: string): string {
    const base = path.basename(name);
    if (base !== name || base.startsWith('.') || !/^[\w.-]+$/.test(base)) {
      throw new Error(`Invalid segment name: ${name}`);
    }
    return base;
  }

  async saveSegment(name: string, content: string): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.saveSegmentCore(name, content));
  }

  private async saveSegmentCore(name: string, content: string): Promise<void> {
    await this.ensureModularStructureCore();
    let safeName = this.sanitizeSegmentName(name);
    if (!safeName.endsWith('.conf')) safeName += '.conf';
    await writeFileAtomic(path.join(SNAPSERVER_CONFIG_DIR, safeName), content, { mode: CONFIG_FILE_MODE });
    await this.rebuildMasterConfigCore();
  }

  async deleteSegment(name: string): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.deleteSegmentCore(name));
  }

  private async deleteSegmentCore(name: string): Promise<void> {
    await this.ensureModularStructureCore();
    const safeName = this.sanitizeSegmentName(name);
    await fs.unlink(path.join(SNAPSERVER_CONFIG_DIR, safeName));
    await this.rebuildMasterConfigCore();
  }

  async setSnapserverDocRoot(docRootPath: string): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.setSnapserverDocRootCore(docRootPath));
  }

  private async setSnapserverDocRootCore(docRootPath: string): Promise<void> {
    // Installing/updating snap-ctrl must NOT reset the user's configuration —
    // it should only change [http] doc_root. We therefore edit the LIVE master
    // (/etc/snapserver.conf, the file snapserver reads and the one the config
    // editor writes to) surgically and in place.
    //
    // We deliberately avoid the old base -> rebuildMasterConfig() path here: the
    // base file is only created once and never re-synced, so if the user had
    // edited their config through the UI after snap-ctrl was first installed,
    // rebuilding the master from the stale base wiped those edits. Editing the
    // live master directly guarantees only doc_root changes.
    const raw = await this.readServerConfig();

    if (raw && raw.trim().length > 20) {
      // Preserve the live config; change only doc_root.
      const updated = surgicallySetIniKey(raw, 'http', 'doc_root', docRootPath);
      await this.writeServerConfigCore(updated);

      // Keep the modular base in sync (if it exists) so a later pipe-source
      // rebuild carries the correct doc_root too — but never rebuild here.
      try {
        await fs.access(SNAPSERVER_CONFIG_BASE);
        const baseRaw = await fs.readFile(SNAPSERVER_CONFIG_BASE, 'utf-8');
        const baseUpdated = surgicallySetIniKey(baseRaw, 'http', 'doc_root', docRootPath);
        await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, baseUpdated, { mode: CONFIG_FILE_MODE });
      } catch {
        // No base file — nothing to keep in sync.
      }
      return;
    }

    // No live config to preserve (missing/empty): fall back to the modular seed.
    try {
      await this.ensureModularStructureCore();
      const baseRaw = await fs.readFile(SNAPSERVER_CONFIG_BASE, 'utf-8');
      const updated = surgicallySetIniKey(baseRaw, 'http', 'doc_root', docRootPath);
      await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, updated, { mode: CONFIG_FILE_MODE });
      await this.rebuildMasterConfigCore();
    } catch (error) {
      console.error('Failed to update doc_root:', error);
      throw error;
    }
  }

  async getTcpSources(): Promise<{ name: string; port: number }[]> {
    const config = await this.readServerConfigParsed();
    const sources: { name: string; port: number }[] = [];

    if (config.stream && config.stream.source) {
      const sourceList = Array.isArray(config.stream.source)
        ? config.stream.source
        : [config.stream.source as any];

      for (const src of sourceList) {
        const srcStr = String(src);
        if (srcStr.startsWith('tcp://')) {
          try {
            // URL parses tcp:// as a valid format usually, but might complain about missing host or format.
            // Let's use Regex for safer extraction, as URL module may sometimes fail on custom URL schemes without SLD
            const match = srcStr.match(/tcp:\/\/([^:/\s]+):(\d+)/);
            if (match) {
              const port = parseInt(match[2], 10);
              const nameMatch = srcStr.match(/[?&]name=([^&]+)/);
              const name = nameMatch ? decodeURIComponent(nameMatch[1]) : `TCP Port ${port}`;
              sources.push({ name, port });
            }
          } catch (e) {
             // Fallback
          }
        }
      }
    }
    return sources;
  }

  async resetToDefault(): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.resetToDefaultCore());
  }

  private async resetToDefaultCore(): Promise<void> {
    await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, DEFAULT_SNAPSERVER_CONF, { mode: CONFIG_FILE_MODE });
    await this.rebuildMasterConfigCore();
  }

  /** Apply an in-place transform to the modular base file if it exists (no rebuild). */
  private async syncBaseInPlaceCore(transform: (content: string) => string): Promise<void> {
    try {
      await fs.access(SNAPSERVER_CONFIG_BASE);
      const baseRaw = await fs.readFile(SNAPSERVER_CONFIG_BASE, 'utf-8');
      const updated = transform(baseRaw);
      if (updated !== baseRaw) await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, updated, { mode: CONFIG_FILE_MODE });
    } catch {
      // No base file — nothing to keep in sync.
    }
  }

  async addStreamSource(uri: string): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.addStreamSourceCore(uri));
  }

  private async addStreamSourceCore(uri: string): Promise<void> {
    // Edit the live master in place so we never revert the user's config, then
    // keep the modular base in sync (see setSnapserverDocRoot for the rationale).
    const raw = await this.readServerConfig();
    if (raw && raw.trim().length > 20) {
      const updated = surgicallyAddStreamSource(raw, uri);
      if (updated !== raw) await this.writeServerConfigCore(updated);
      await this.syncBaseInPlaceCore(base => surgicallyAddStreamSource(base, uri));
      return;
    }
    // No live config to preserve — fall back to the modular seed + rebuild.
    await this.ensureModularStructureCore();
    const base = await fs.readFile(SNAPSERVER_CONFIG_BASE, 'utf-8');
    const updated = surgicallyAddStreamSource(base, uri);
    if (updated !== base) {
      await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, updated, { mode: CONFIG_FILE_MODE });
      await this.rebuildMasterConfigCore();
    }
  }

  async removeStreamSourceByFifo(fifoPath: string): Promise<void> {
    return this.mutex.withLock(CONFIG_LOCK_KEY, () => this.removeStreamSourceByFifoCore(fifoPath));
  }

  private async removeStreamSourceByFifoCore(fifoPath: string): Promise<void> {
    const raw = await this.readServerConfig();
    if (raw && raw.trim().length > 20) {
      const updated = surgicallyRemoveStreamSourcesByFifo(raw, fifoPath);
      if (updated !== raw) await this.writeServerConfigCore(updated);
      await this.syncBaseInPlaceCore(base => surgicallyRemoveStreamSourcesByFifo(base, fifoPath));
      return;
    }
    await this.ensureModularStructureCore();
    const base = await fs.readFile(SNAPSERVER_CONFIG_BASE, 'utf-8');
    const updated = surgicallyRemoveStreamSourcesByFifo(base, fifoPath);
    if (updated !== base) {
      await installPrivilegedFile(SNAPSERVER_CONFIG_BASE, updated, { mode: CONFIG_FILE_MODE });
      await this.rebuildMasterConfigCore();
    }
  }
}

export const configService = new ConfigService();
