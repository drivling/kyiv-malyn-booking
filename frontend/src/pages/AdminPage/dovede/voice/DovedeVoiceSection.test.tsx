/**
 * Лабораторія «Голос» (Docs/dovede-voice-roadmap.md, Ф1·1): таблиця фраз, підсумок, завантаження моделі лише за
 * кліком, розділ відкривається з вкладки «Доведе» лениво. Справжню модель і мікрофон у тестах не чіпаємо.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const loadWhisper = vi.fn(async (_size: string, _mode: string, onProgress?: (p: { loadedMb: number; totalMb: number }) => void) => {
  onProgress?.({ loadedMb: 73, totalMb: 146 });
});

vi.mock('./whisper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./whisper')>()),
  loadWhisper: (...args: Parameters<typeof loadWhisper>) => loadWhisper(...args),
  isWhisperLoaded: () => false,
  transcribeWhisper: vi.fn(async () => ({ text: '', ms: 0 })),
}));

import DovedeTab from '../DovedeTab';
import DovedeVoiceSection from './DovedeVoiceSection';

beforeEach(() => {
  loadWhisper.mockClear();
  window.localStorage.clear();
});

describe('DovedeVoiceSection', () => {
  it('показує всі фрази з групами й порожній підсумок', () => {
    render(<DovedeVoiceSection />);
    expect(screen.getByRole('heading', { name: 'Голос' })).toBeInTheDocument();
    expect(screen.getByText('Як доїхати з паперової фабрики до вокзалу')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Записати/ })).toHaveLength(41);
  });

  it('модель не вантажиться, поки не натиснули кнопку', async () => {
    const user = userEvent.setup();
    render(<DovedeVoiceSection />);
    expect(loadWhisper).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Завантажити модель/ }));
    expect(loadWhisper).toHaveBeenCalledTimes(1);
    expect(loadWhisper.mock.calls[0][0]).toBe('base');
    expect(await screen.findByRole('button', { name: 'Модель готова' })).toBeDisabled();
  });

  it('вкладка «Доведе» відкриває розділ «Голос» за адресою /admin/dovede/voice', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/dovede/voice']}>
        <DovedeTab section="voice" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Голос' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Голос' })).toHaveAttribute('aria-current', 'page');
  });
});
