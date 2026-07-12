import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  surgicallySetIniKey,
  surgicallyAddStreamSource,
  surgicallyRemoveStreamSourcesByFifo,
} from './snapConfigEdit';

const SAMPLE = `# Mi setup
[server]
threads = -1

[stream]
buffer = 1000
# Spotify
source = tcp://0.0.0.0:4953?name=Spotify

[http]
doc_root = /usr/share/snapserver/snapweb

[logging]
debug = true`;

test('surgicallySetIniKey replaces only the target value', () => {
  const out = surgicallySetIniKey(SAMPLE, 'http', 'doc_root', '/usr/share/snapserver/snap-ctrl/dist');
  assert.ok(out.includes('doc_root = /usr/share/snapserver/snap-ctrl/dist'));
  assert.ok(!out.includes('doc_root = /usr/share/snapserver/snapweb'));
  // everything else preserved
  assert.ok(out.includes('# Mi setup'));
  assert.ok(out.includes('source = tcp://0.0.0.0:4953?name=Spotify'));
  assert.ok(out.includes('debug = true'));
  assert.equal((out.match(/^\[http\]/gm) || []).length, 1);
  assert.equal(out.split('\n').length, SAMPLE.split('\n').length);
});

test('surgicallySetIniKey inserts the key when missing', () => {
  const out = surgicallySetIniKey('[http]\nenabled = true\n\n[tcp]\nenabled = true', 'http', 'doc_root', '/x');
  assert.ok(/\[http\][\s\S]*doc_root = \/x[\s\S]*\[tcp\]/.test(out));
});

test('surgicallyAddStreamSource inserts source with name comment inside [stream]', () => {
  const out = surgicallyAddStreamSource(SAMPLE, 'pipe:///tmp/snapfifo_jazz?name=Jazz&codec=pcm');
  assert.ok(out.includes('# Jazz'));
  assert.ok(out.includes('source = pipe:///tmp/snapfifo_jazz?name=Jazz&codec=pcm'));
  assert.ok(out.includes('source = tcp://0.0.0.0:4953?name=Spotify')); // existing kept
  assert.ok(out.indexOf('snapfifo_jazz') > out.indexOf('[stream]'));
  assert.ok(out.indexOf('snapfifo_jazz') < out.indexOf('[http]'));
  assert.equal((out.match(/^\[stream\]/gm) || []).length, 1);
});

test('surgicallyAddStreamSource is idempotent', () => {
  const once = surgicallyAddStreamSource(SAMPLE, 'pipe:///tmp/snapfifo_x?name=X&codec=pcm');
  const twice = surgicallyAddStreamSource(once, 'pipe:///tmp/snapfifo_x?name=X&codec=pcm');
  assert.equal((twice.match(/snapfifo_x/g) || []).length, 1);
});

test('surgicallyAddStreamSource creates [stream] when absent', () => {
  const out = surgicallyAddStreamSource('[server]\nthreads = -1\n', 'pipe:///tmp/snapfifo_x?name=X&codec=pcm');
  assert.ok(out.includes('[stream]'));
  assert.ok(out.includes('source = pipe:///tmp/snapfifo_x?name=X&codec=pcm'));
  assert.ok(out.includes('threads = -1'));
});

test('add then remove returns the original config', () => {
  const added = surgicallyAddStreamSource(SAMPLE, 'pipe:///tmp/snapfifo_jazz?name=Jazz&codec=pcm');
  const removed = surgicallyRemoveStreamSourcesByFifo(added, '/tmp/snapfifo_jazz');
  assert.equal(removed, SAMPLE);
});

test('remove keeps unrelated sources and comments', () => {
  const added = surgicallyAddStreamSource(SAMPLE, 'pipe:///tmp/snapfifo_jazz?name=Jazz&codec=pcm');
  const removed = surgicallyRemoveStreamSourcesByFifo(added, '/tmp/snapfifo_jazz');
  assert.ok(!removed.includes('snapfifo_jazz'));
  assert.ok(!removed.includes('# Jazz'));
  assert.ok(removed.includes('source = tcp://0.0.0.0:4953?name=Spotify'));
  assert.ok(removed.includes('# Spotify'));
});

test('divergence: adding a pipe to a UI-edited master preserves user edits', () => {
  const master = `[stream]
buffer = 1200
codec = flac
source = tcp://0.0.0.0:4953?name=Spotify

[http]
doc_root = /usr/share/snapserver/snap-ctrl/dist`;
  const out = surgicallyAddStreamSource(master, 'pipe:///tmp/snapfifo_radio?name=Radio&codec=pcm');
  assert.ok(out.includes('buffer = 1200'));
  assert.ok(out.includes('codec = flac'));
  assert.ok(out.includes('snapfifo_radio'));
  assert.ok(out.includes('doc_root = /usr/share/snapserver/snap-ctrl/dist'));
});
