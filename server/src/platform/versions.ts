// Comparing package versions across the formats they arrive in. The same
// release reads `26.1.2` from a binary's --version, `v26.1.2` from a GitHub
// tag, and `7:7.1.5-0+deb13u1` or `0.35.0.naturaldevcr.beta.6-1` from dpkg.

/**
 * Reduces any of those formats to `<numbers>[-<prerelease>]`, or null when
 * `raw` holds no version ('unknown', 'v22.x (Latest)', empty).
 */
export function canonicalVersion(raw: string | null | undefined): string | null {
  const version = (raw ?? '')
    .trim()
    .replace(/^v/i, '')
    .replace(/^\d+:/, '') // Debian epoch
    .replace(/-\d[\w.+~]*$/, '') // Debian revision; prereleases start with a letter
    .replace('.naturaldevcr.', '-naturaldevcr.'); // .deb form of the beta tag
  return /^\d+(\.\d+)+(?:[-+][\w.+-]*)?$/.test(version) ? version : null;
}

function parts(version: string): { core: number[]; prerelease: string } {
  const [core, ...prerelease] = version.split('-');
  return {
    core: core.split('+')[0].split('.').map(Number),
    prerelease: prerelease.join('-'),
  };
}

/** Compares two canonical versions: negative, 0 or positive, like a sort callback. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  // A release outranks any prerelease of the same version.
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  const order = left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true });
  return order > 0 ? 1 : -1;
}

/** True only when both versions are known and `candidate` is ahead of `installed`. */
export function isNewerVersion(
  candidate: string | null | undefined,
  installed: string | null | undefined,
): boolean {
  const next = canonicalVersion(candidate);
  const current = canonicalVersion(installed);
  return !!next && !!current && compareVersions(next, current) > 0;
}
