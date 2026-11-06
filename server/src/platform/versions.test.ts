import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalVersion, compareVersions, isNewerVersion } from './versions';

test('canonicalVersion() reduces every source format to a comparable form', () => {
  assert.equal(canonicalVersion('v26.1.2'), '26.1.2');
  assert.equal(canonicalVersion('7:7.1.5-0+deb13u1'), '7.1.5');
  assert.equal(canonicalVersion('0.35.0-1'), '0.35.0');
  assert.equal(canonicalVersion('v0.35.0-naturaldevcr.beta.6'), '0.35.0-naturaldevcr.beta.6');
  assert.equal(canonicalVersion('0.35.0.naturaldevcr.beta.6-1'), '0.35.0-naturaldevcr.beta.6');
});

test('canonicalVersion() returns null when no version is known', () => {
  for (const raw of ['unknown', '', undefined, null, 'v22.x (Latest)']) {
    assert.equal(canonicalVersion(raw), null);
  }
});

test('compareVersions() compares numerically, not as text', () => {
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('26.1.2', '26.1.2'), 0);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
});

test('compareVersions() ranks a prerelease below its release', () => {
  assert.equal(compareVersions('0.35.0-naturaldevcr.beta.6', '0.35.0'), -1);
  assert.equal(compareVersions('0.35.0-naturaldevcr.beta.10', '0.35.0-naturaldevcr.beta.9'), 1);
});

test('isNewerVersion() is false across formats of the same version', () => {
  assert.equal(isNewerVersion('v26.1.2', '26.1.2'), false);
  assert.equal(isNewerVersion('v0.35.0', '0.35.0-1'), false);
  assert.equal(isNewerVersion('5.6.2', '5.6.2'), false);
});

test('isNewerVersion() only reports a real upgrade', () => {
  assert.equal(isNewerVersion('v0.36.0', '0.35.0'), true);
  assert.equal(isNewerVersion('v0.34.0', '0.35.0'), false);
});

test('isNewerVersion() is false when either side is unknown', () => {
  assert.equal(isNewerVersion('unknown', '1.0.0'), false);
  assert.equal(isNewerVersion('v1.0.0', 'unknown'), false);
});
