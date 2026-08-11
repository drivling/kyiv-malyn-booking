import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, screen } from '@/test/utils';
import { ProtectedRoute } from '@/components/ProtectedRoute/ProtectedRoute';
import { apiClient } from '@/api/client';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';

describe('ProtectedRoute', () => {
  beforeEach(() => {
    apiClient.setAuthToken(null);
  });

  it('shows LoginPage when there is no token', async () => {
    renderWithProviders(
      <ProtectedRoute>
        <div>secret-admin</div>
      </ProtectedRoute>
    );

    expect(await screen.findByRole('heading', { name: 'Увійти' })).toBeInTheDocument();
    expect(screen.queryByText('secret-admin')).not.toBeInTheDocument();
  });

  it('renders children when checkAdminAuth succeeds', async () => {
    apiClient.setAuthToken('admin-authenticated');

    renderWithProviders(
      <ProtectedRoute>
        <div>secret-admin</div>
      </ProtectedRoute>
    );

    expect(await screen.findByText('secret-admin')).toBeInTheDocument();
  });

  it('clears invalid token and shows LoginPage', async () => {
    apiClient.setAuthToken('stale-token');
    server.use(
      http.get(`${TEST_API_URL}/admin/check`, () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
      )
    );

    renderWithProviders(
      <ProtectedRoute>
        <div>secret-admin</div>
      </ProtectedRoute>
    );

    expect(await screen.findByRole('heading', { name: 'Увійти' })).toBeInTheDocument();
    await waitFor(() => {
      expect(apiClient.getAuthToken()).toBeNull();
    });
  });
});
