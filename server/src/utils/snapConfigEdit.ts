/**
 * Surgical, comment-preserving edits to a snapserver.conf file.
 *
 * These operate on the raw text (never parse/stringify the whole file) so that
 * user comments, formatting, and unrelated keys are preserved. This is what
 * keeps snap-ctrl updates and pipe-source changes from resetting the config.
 */

/** Set (or insert) a single `key = value` under [section], replacing in place. */
export function surgicallySetIniKey(content: string, section: string, key: string, value: string): string {
  const lines = content.split('\n');
  const sectionHeader = `[${section}]`;
  let inTargetSection = false;
  let keyFound = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (inTargetSection && !keyFound) {
        lines.splice(i, 0, `${key} = ${value}`);
        keyFound = true;
      }
      inTargetSection = trimmed === sectionHeader;
      continue;
    }

    if (inTargetSection && lines[i]!.includes('=')) {
      const eqIdx = lines[i]!.indexOf('=');
      const existingKey = lines[i]!.substring(0, eqIdx).trim();
      if (existingKey === key) {
        const indent = lines[i]!.match(/^(\s*)/)?.[1] ?? '';
        lines[i] = `${indent}${key} = ${value}`;
        keyFound = true;
      }
    }
  }

  if (!keyFound) {
    lines.push('');
    lines.push(sectionHeader);
    lines.push(`${key} = ${value}`);
  }

  return lines.join('\n');
}

/** Insert a `source = <uri>` line (with a name comment) into [stream], preserving the rest. */
export function surgicallyAddStreamSource(content: string, uri: string): string {
  const lines = content.split('\n');
  const sourceLine = `source = ${uri}`;
  if (lines.some(l => l.trim() === sourceLine)) return content; // already present

  const nameMatch = uri.match(/[?&]name=([^&]+)/);
  const name = nameMatch ? decodeURIComponent(nameMatch[1]!) : '';
  const insertLines = name ? [`# ${name}`, sourceLine] : [sourceLine];

  let streamStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '[stream]') { streamStart = i; break; }
  }

  if (streamStart === -1) {
    // No [stream] section yet — append one at the end.
    const prefix = content.replace(/\n*$/, '');
    return `${prefix}\n\n[stream]\n${insertLines.join('\n')}\n`;
  }

  // Find the end of the [stream] block (next section header or EOF)…
  let blockEnd = lines.length;
  for (let i = streamStart + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.startsWith('[') && t.endsWith(']')) { blockEnd = i; break; }
  }
  // …then step back over trailing blank lines so we insert right after real content.
  let insertAt = blockEnd;
  while (insertAt > streamStart + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;

  lines.splice(insertAt, 0, ...insertLines);
  return lines.join('\n');
}

/** Remove any `source = …` line whose value contains fifoPath (plus a paired name comment). */
export function surgicallyRemoveStreamSourcesByFifo(content: string, fifoPath: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const isSource = trimmed.includes('=') && trimmed.slice(0, trimmed.indexOf('=')).trim() === 'source';
    if (isSource && line.includes(fifoPath)) {
      // Drop a preceding name-comment line (as emitted alongside sources).
      if (result.length && result[result.length - 1]!.trim().startsWith('#')) {
        result.pop();
      }
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}
