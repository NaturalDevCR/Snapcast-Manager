import { describe, expect, it, vi, afterEach } from 'vitest';
import { detectDefaultLocale } from '../i18n';

describe('detectDefaultLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "es" when navigator.language starts with "es"', () => {
    vi.stubGlobal('navigator', { language: 'es-CR' });
    expect(detectDefaultLocale()).toBe('es');
  });

  it('returns "en" when navigator.language starts with "en"', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(detectDefaultLocale()).toBe('en');
  });

  it('falls back to "en" for any unsupported locale', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' });
    expect(detectDefaultLocale()).toBe('en');
  });
});
