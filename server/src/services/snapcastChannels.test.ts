import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'snapcast-channels-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.SNAPCAST_CHANNELS_PATH = path.join(dir, 'channels.json');
let channels: typeof import('./snapcastChannels');
test.before(async () => {
  channels = await import('./snapcastChannels');
});
const tag = 'v0.35.0-naturaldevcr.beta.1';
const asset = {
  name: 'snapclient_0.35.0~naturaldevcr.beta.1-1_arm64_bookworm.deb',
  size: 123,
  digest: `sha256:${'a'.repeat(64)}`,
  browser_download_url: `https://github.com/NaturalDevCR/snapcast/releases/download/${tag}/snapclient.deb`,
};

test('channel settings default to official, persist independently, and survive concurrent saves', async () => {
  const { readChannels, saveChannel } = channels;
  assert.equal((await readChannels()).snapclient.channel, 'official');
  await Promise.all([
    saveChannel('snapclient', { channel: 'beta', tag }),
    saveChannel('snapserver', { channel: 'beta' }),
  ]);
  assert.deepEqual(await readChannels(), {
    snapclient: { channel: 'beta', tag },
    snapserver: { channel: 'beta' },
  });
  await saveChannel('snapclient', { channel: 'official' });
  assert.equal((await readChannels()).snapserver.channel, 'beta');
  assert.equal((await readChannels()).snapclient.channel, 'official');
});

test('invalid channels and tags are rejected', () => {
  const { validateSelection } = channels;
  for (const value of [
    { channel: 'other' },
    { channel: 'beta', tag: '../main' },
    { channel: 'official', tag },
    null,
  ]) {
    assert.throws(() => validateSelection(value));
  }
});

test('beta packages require exact architecture, distro, repository, and checksum metadata', () => {
  const { selectBetaAsset } = channels;
  const release = { tag_name: tag, assets: [asset] };
  assert.equal(selectBetaAsset(release, 'snapclient', 'arm64', 'bookworm'), asset);
  assert.throws(() => selectBetaAsset(release, 'snapclient', 'armhf', 'bookworm'));
  assert.throws(() => selectBetaAsset(release, 'snapclient', 'arm64', 'trixie'));
  assert.throws(() =>
    selectBetaAsset(
      { ...release, assets: [{ ...asset, digest: null }] },
      'snapclient',
      'arm64',
      'bookworm',
    ),
  );
  assert.throws(() =>
    selectBetaAsset(
      { ...release, assets: [{ ...asset, browser_download_url: 'https://example.com/a.deb' }] },
      'snapclient',
      'arm64',
      'bookworm',
    ),
  );
});

test('beta discovery excludes drafts and stable releases and sorts by publication date', async () => {
  const { fetchBetaReleases } = channels;
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        { tag_name: tag, prerelease: true, draft: false, published_at: '2026-10-01' },
        {
          tag_name: 'v0.35.0-naturaldevcr.beta.2',
          prerelease: true,
          draft: false,
          published_at: '2026-10-05',
        },
        { tag_name: 'v0.35.0-naturaldevcr.beta.3', prerelease: true, draft: true },
        { tag_name: 'v0.35.0', prerelease: false },
      ]),
    );
  try {
    assert.deepEqual(
      (await fetchBetaReleases()).map((r: any) => r.tag_name),
      ['v0.35.0-naturaldevcr.beta.2', tag],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test.after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
