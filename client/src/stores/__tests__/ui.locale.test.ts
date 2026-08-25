import { describe, expect, it, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUIStore } from '../ui';
import { i18n } from '../../i18n';

describe('useUIStore locale', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('setLocale("es") updates the store, the i18n instance, and localStorage', () => {
    const store = useUIStore();
    store.setLocale('es');
    expect(store.locale).toBe('es');
    expect(i18n.global.locale.value).toBe('es');
    expect(localStorage.getItem('locale')).toBe('es');
  });

  it('ignores an unsupported locale value', () => {
    const store = useUIStore();
    const before = store.locale;
    // @ts-expect-error -- deliberately passing an invalid value
    store.setLocale('fr');
    expect(store.locale).toBe(before);
  });
});
