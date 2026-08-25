import { describe, expect, it, vi, afterEach } from 'vitest';
import { detectDefaultLocale, i18n } from '../i18n';

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

// Regression guard for the real, shared i18n singleton (as opposed to the
// separate, always-correctly-configured test-only instance built by
// `client/src/test/mountView.ts`'s `createTestI18n()`). A namespace can be
// added to that test helper alone (e.g. by copy-pasting the `common`
// pattern into `messages` there) without ever being registered on this
// exported `i18n` instance that `main.ts` actually installs into the app —
// which silently renders raw translation keys (e.g. "layout.dashboard")
// in production while every test mounted via `mountSmokeTest()` still
// passes, because those tests never touch this real instance. See Task 52
// review (`.superpowers/sdd/task-52-review.md`) for the incident this
// guards against.
describe('real i18n singleton has all namespaces registered', () => {
  const originalLocale = i18n.global.locale.value;

  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it.each(['en', 'es'] as const)('resolves common.* keys for locale "%s" (not the raw key)', (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.te('common.save')).toBe(true);
  });

  it.each(['en', 'es'] as const)('resolves layout.dashboard for locale "%s" (not the raw key)', (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.t('layout.dashboard')).not.toBe('layout.dashboard');
  });

  it('resolves layout.dashboard to the correct translated string per locale', () => {
    i18n.global.locale.value = 'en';
    expect(i18n.global.t('layout.dashboard')).toBe('Dashboard');

    i18n.global.locale.value = 'es';
    expect(i18n.global.t('layout.dashboard')).toBe('Panel');
  });

  it.each(['en', 'es'] as const)('resolves login.title for locale "%s" (not the raw key)', (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.t('login.title')).not.toBe('login.title');
  });

  it('resolves login.title and login.signIn to the correct translated string per locale', () => {
    i18n.global.locale.value = 'en';
    expect(i18n.global.t('login.title')).toBe('Snapcast Manager');
    expect(i18n.global.t('login.signIn')).toBe('Sign In');

    i18n.global.locale.value = 'es';
    expect(i18n.global.t('login.title')).toBe('Snapcast Manager');
    expect(i18n.global.t('login.signIn')).toBe('Iniciar Sesión');
  });

  it.each(['en', 'es'] as const)('resolves setup.title for locale "%s" (not the raw key)', (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.t('setup.title')).not.toBe('setup.title');
  });

  it('resolves setup.title and setup.submit to the correct translated string per locale', () => {
    i18n.global.locale.value = 'en';
    expect(i18n.global.t('setup.title')).toBe('System Ignition');
    expect(i18n.global.t('setup.submit')).toBe('Complete Setup & Launch');

    i18n.global.locale.value = 'es';
    expect(i18n.global.t('setup.title')).toBe('Ignición del Sistema');
    expect(i18n.global.t('setup.submit')).toBe('Completar Configuración y Lanzar');
  });

  it.each(['en', 'es'] as const)('resolves onboarding.step1Title for locale "%s" (not the raw key)', (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.t('onboarding.step1Title')).not.toBe('onboarding.step1Title');
  });

  it('resolves onboarding.step1Title and onboarding.skip to the correct translated string per locale', () => {
    i18n.global.locale.value = 'en';
    expect(i18n.global.t('onboarding.step1Title')).toBe('1. Set Up Snapserver');
    expect(i18n.global.t('onboarding.skip')).toBe('Skip for now');

    i18n.global.locale.value = 'es';
    expect(i18n.global.t('onboarding.step1Title')).toBe('1. Configurar Snapserver');
    expect(i18n.global.t('onboarding.skip')).toBe('Omitir por ahora');
  });

  // Step 3's dynamic zone-name interpolation (Task 55 CRITICAL note):
  // proves the real singleton resolves named interpolation, not just flat
  // strings, for both the "has a real name" and "falls back to a synthetic
  // name from the id" cases.
  it('resolves onboarding.step3ZoneReady and onboarding.zoneFallbackName with named interpolation per locale', () => {
    i18n.global.locale.value = 'en';
    expect(i18n.global.t('onboarding.step3ZoneReady', { zoneName: 'Living Room' })).toBe(
      'Living Room is ready. Pick a source for it:',
    );
    expect(i18n.global.t('onboarding.zoneFallbackName', { id: 'g1ab' })).toBe('Zone g1ab');

    i18n.global.locale.value = 'es';
    expect(i18n.global.t('onboarding.step3ZoneReady', { zoneName: 'Sala' })).toBe(
      'Sala está lista. Elige una fuente para ella:',
    );
    expect(i18n.global.t('onboarding.zoneFallbackName', { id: 'g1ab' })).toBe('Zona g1ab');
  });
});
