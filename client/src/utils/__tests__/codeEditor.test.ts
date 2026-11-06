import { describe, expect, it } from 'vitest';

describe('code editor CSP safety', () => {
  // prism-code-editor/setups injects <style> elements, which the server's
  // `style-src 'self'` CSP blocks in production only. See ../codeEditor.ts.
  it('never imports prism-code-editor/setups', () => {
    const sources = import.meta.glob(['/src/**/*.ts', '/src/**/*.vue', '!/src/**/__tests__/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    expect(Object.keys(sources).length).toBeGreaterThan(10);
    const offenders = Object.entries(sources)
      .filter(([, source]) => /from ['"]prism-code-editor\/setups['"]/.test(source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
