import { describe, it, expect, beforeEach } from 'vitest';
import { apiClient } from '@/api/client';
import { server } from '@/test/msw/server';
import { http, HttpResponse } from 'msw';
import { TEST_API_URL } from '@/test/msw/handlers';

describe('apiClient admin auth', () => {
  beforeEach(() => {
    apiClient.setAuthToken(null);
  });

  it('adminLogin returns token and does not auto-store until setAuthToken', async () => {
    const result = await apiClient.adminLogin('any');
    expect(result.success).toBe(true);
    expect(result.token).toBe('admin-authenticated');
    expect(apiClient.getAuthToken()).toBeNull();
  });

  it('checkAdminAuth sends Authorization header', async () => {
    apiClient.setAuthToken('admin-authenticated');
    const res = await apiClient.checkAdminAuth();
    expect(res.authenticated).toBe(true);
  });

  it('checkAdminAuth rejects without valid token', async () => {
    apiClient.setAuthToken('bad');
    server.use(
      http.get(`${TEST_API_URL}/admin/check`, () =>
        HttpResponse.json({ error: 'no' }, { status: 401 })
      )
    );
    await expect(apiClient.checkAdminAuth()).rejects.toThrow();
  });

  it('setAuthToken mirrors localStorage adminToken', () => {
    apiClient.setAuthToken('admin-authenticated');
    expect(localStorage.getItem('adminToken')).toBe('admin-authenticated');
    apiClient.setAuthToken(null);
    expect(localStorage.getItem('adminToken')).toBeNull();
  });
});
