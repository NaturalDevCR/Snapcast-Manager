import { describe, expect, it } from 'vitest';
import { sseStatusBadge } from '../sseStatus';

describe('sseStatusBadge', () => {
  it('maps "connected" to a success-variant "Live" badge', () => {
    expect(sseStatusBadge('connected')).toEqual({ variant: 'success', label: 'Live' });
  });

  it('maps "reconnecting" to a warning-variant badge', () => {
    expect(sseStatusBadge('reconnecting').variant).toBe('warning');
    expect(sseStatusBadge('reconnecting').label).toMatch(/reconnect/i);
  });

  it('maps "connecting" to a neutral-variant badge', () => {
    expect(sseStatusBadge('connecting').variant).toBe('neutral');
  });

  it('maps "disconnected" to a danger-variant "Offline" badge', () => {
    expect(sseStatusBadge('disconnected')).toEqual({ variant: 'danger', label: 'Offline' });
  });
});
