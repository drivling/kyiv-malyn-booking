import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/api/client';
import { AdminOnly } from './AdminOnly';

describe('AdminOnly — таємна сторінка без форми входу', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('без токена — порожньо і без запиту на сервер', () => {
    vi.spyOn(apiClient, 'getAuthToken').mockReturnValue(null);
    const check = vi.spyOn(apiClient, 'checkAdminAuth');
    const { container } = render(<AdminOnly><p>секрет</p></AdminOnly>);
    expect(container).toBeEmptyDOMElement();
    expect(check).not.toHaveBeenCalled();
  });

  it('токен підтвердився — показує сторінку', async () => {
    vi.spyOn(apiClient, 'getAuthToken').mockReturnValue('t');
    vi.spyOn(apiClient, 'checkAdminAuth').mockResolvedValue({ authenticated: true });
    render(<AdminOnly><p>секрет</p></AdminOnly>);
    expect(await screen.findByText('секрет')).toBeInTheDocument();
  });

  it('токен не підтвердився — порожньо, без LoginPage', async () => {
    vi.spyOn(apiClient, 'getAuthToken').mockReturnValue('t');
    const check = vi.spyOn(apiClient, 'checkAdminAuth').mockRejectedValue(new Error('401'));
    const { container } = render(<AdminOnly><p>секрет</p></AdminOnly>);
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/увійти|пароль/i)).toBeNull();
  });
});
