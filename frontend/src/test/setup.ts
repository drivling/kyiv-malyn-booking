import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import { server } from './msw/server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  apiClient.setAuthToken(null);
  userState.logout();
});

afterAll(() => {
  server.close();
});
