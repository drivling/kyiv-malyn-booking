import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_TOKEN_STORAGE_KEY,
  purgeStaleAdminTokens,
  readAdminToken,
  writeAdminToken,
} from './adminTokenStorage';

describe('admin token storage', () => {
  it('keeps the token under the current key only', () => {
    writeAdminToken('t');
    expect(localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)).toBe('t');
    expect(readAdminToken()).toBe('t');
    expect(localStorage.getItem('adminToken')).toBeNull();
    writeAdminToken(null);
    expect(readAdminToken()).toBeNull();
  });

  it('purge wipes tokens under old key names and the admin login state that came with them', () => {
    localStorage.setItem('adminToken', 'old');
    localStorage.setItem('admin_token', 'old');
    localStorage.setItem('adminToken:earlier', 'older');
    localStorage.setItem('user_state', JSON.stringify({ type: 'admin', token: 'old' }));
    localStorage.setItem('transport-dataset:v1', '{}');

    purgeStaleAdminTokens();

    expect(localStorage.getItem('adminToken')).toBeNull();
    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(localStorage.getItem('adminToken:earlier')).toBeNull();
    expect(localStorage.getItem('user_state')).toBeNull();
    expect(localStorage.getItem('transport-dataset:v1')).toBe('{}');
  });

  it('purge keeps a login made under the current key', () => {
    writeAdminToken('new');
    localStorage.setItem('user_state', JSON.stringify({ type: 'admin', token: 'new' }));

    purgeStaleAdminTokens();

    expect(readAdminToken()).toBe('new');
    expect(JSON.parse(localStorage.getItem('user_state') ?? 'null')).toEqual({ type: 'admin', token: 'new' });
  });

  it('purge never touches a Telegram login', () => {
    const telegram = JSON.stringify({ type: 'telegram', user: { id: 1 }, phone: '' });
    localStorage.setItem('user_state', telegram);
    localStorage.setItem('adminToken', 'old');

    purgeStaleAdminTokens();

    expect(localStorage.getItem('user_state')).toBe(telegram);
    expect(localStorage.getItem('adminToken')).toBeNull();
  });

  it('a damaged user_state does not stop the purge', () => {
    localStorage.setItem('adminToken', 'old');
    localStorage.setItem('user_state', '{oops');
    expect(() => purgeStaleAdminTokens()).not.toThrow();
    expect(localStorage.getItem('adminToken')).toBeNull();
  });
});

describe('a browser that logged in before the key changed', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('opens the site logged out, with no copy of the old token left', async () => {
    localStorage.setItem('adminToken', 'admin-authenticated');
    localStorage.setItem('admin_token', 'admin-authenticated');
    localStorage.setItem('user_state', JSON.stringify({ type: 'admin', token: 'admin-authenticated' }));
    vi.resetModules();

    const { apiClient } = await import('@/api/client');
    const { userState } = await import('@/utils/userState');

    expect(apiClient.getAuthToken()).toBeNull();
    expect(userState.isAdmin()).toBe(false);
    expect(localStorage.getItem('adminToken')).toBeNull();
    expect(localStorage.getItem('admin_token')).toBeNull();
  });
});
