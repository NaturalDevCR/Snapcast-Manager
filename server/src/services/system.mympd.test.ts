import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mympdObsRepoDir } from './system';

test('mympdObsRepoDir maps debian to Debian_<major>', () => {
  assert.equal(mympdObsRepoDir('debian', '12'), 'Debian_12');
  assert.equal(mympdObsRepoDir('debian', '12.5'), 'Debian_12');
});

test('mympdObsRepoDir maps raspbian', () => {
  assert.equal(mympdObsRepoDir('raspbian', '11'), 'Raspbian_11');
});

test('mympdObsRepoDir maps ubuntu to xUbuntu_<versionId>', () => {
  assert.equal(mympdObsRepoDir('ubuntu', '24.04'), 'xUbuntu_24.04');
});

test('mympdObsRepoDir is case-insensitive', () => {
  assert.equal(mympdObsRepoDir('Debian', '12'), 'Debian_12');
});

test('mympdObsRepoDir returns null for unsupported/empty', () => {
  assert.equal(mympdObsRepoDir('fedora', '40'), null);
  assert.equal(mympdObsRepoDir('', ''), null);
});
