import fs from 'fs/promises';
import path from 'path';
import { dbDir } from '../database';
import { writeFileAtomic } from '../platform/files';
import { KeyedMutex } from '../platform/mutex';

export type SnapcastPackage = 'snapserver' | 'snapclient';
export type InstallChannel = 'official' | 'beta';
export interface ChannelSelection { channel: InstallChannel; tag?: string }
const settingsPath = process.env.SNAPCAST_CHANNELS_PATH || path.join(dbDir, 'snapcast-channels.json');
const mutex = new KeyedMutex();
const defaults = (): Record<SnapcastPackage, ChannelSelection> => ({ snapserver: { channel: 'official' }, snapclient: { channel: 'official' } });

export function validateSelection(value: any): ChannelSelection {
  if (!value || !['official', 'beta'].includes(value.channel)) throw new Error('Invalid installation channel');
  if (value.tag !== undefined && (typeof value.tag !== 'string' || !/^v[0-9]+\.[0-9]+\.[0-9]+-naturaldevcr\.beta\.[0-9]+$/.test(value.tag))) throw new Error('Invalid beta release tag');
  if (value.channel === 'official' && value.tag !== undefined) throw new Error('Official channel does not accept a beta tag');
  return { channel: value.channel, ...(value.tag ? { tag: value.tag } : {}) };
}

export async function readChannels(): Promise<Record<SnapcastPackage, ChannelSelection>> {
  try {
    const data = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    return { snapserver: validateSelection(data.snapserver), snapclient: validateSelection(data.snapclient) };
  } catch (error: any) {
    if (error.code === 'ENOENT') return defaults();
    throw error;
  }
}

export async function saveChannel(pkg: SnapcastPackage, selection: ChannelSelection): Promise<void> {
  const valid = validateSelection(selection);
  await mutex.withLock('channels', async () => {
    const data = await readChannels();
    data[pkg] = valid;
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFileAtomic(settingsPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  });
}

export function selectBetaAsset(release: any, pkg: SnapcastPackage, arch: string, distro: string): any {
  const suffix = `_${arch}_${distro}.deb`;
  const asset = release.assets?.find((a: any) => typeof a.name === 'string' && a.name.startsWith(`${pkg}_`) && a.name.endsWith(suffix));
  if (!asset) throw new Error(`No ${pkg} beta package for ${arch}/${distro} in ${release.tag_name}`);
  const url = new URL(asset.browser_download_url);
  if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/NaturalDevCR/snapcast/releases/download/${release.tag_name}/`)) throw new Error('Unexpected beta package download URL');
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('Beta package is missing its size or SHA-256 digest');
  return asset;
}

async function queryBetaReleases(): Promise<any[]> {
  const releases: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(`https://api.github.com/repos/NaturalDevCR/snapcast/releases?per_page=100&page=${page}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`GitHub beta releases returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid beta releases response');
    releases.push(...data.filter(r => r.prerelease && !r.draft && /^v[0-9]+\.[0-9]+\.[0-9]+-naturaldevcr\.beta\.[0-9]+$/.test(r.tag_name)));
    if (data.length < 100) break;
  }
  return releases.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}


let releaseCache: { releases: any[]; expires: number } | undefined;
let pendingReleases: Promise<any[]> | undefined;
export async function fetchBetaReleases(): Promise<any[]> {
  if (releaseCache && releaseCache.expires > Date.now()) return releaseCache.releases;
  if (!pendingReleases) {
    pendingReleases = queryBetaReleases().then(releases => {
      releaseCache = { releases, expires: Date.now() + 120000 };
      return releases;
    }).finally(() => { pendingReleases = undefined; });
  }
  return pendingReleases;
}
