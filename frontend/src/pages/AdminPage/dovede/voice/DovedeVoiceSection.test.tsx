/**
 * Лабораторія «Голос» (Docs/dovede-voice-roadmap.md): таблиця фраз, підсумок, розділ відкривається з вкладки «Доведе»
 * лениво. Мікрофон і Web Speech у тестах не чіпаємо.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DovedeTab from '../DovedeTab';
import DovedeVoiceSection from './DovedeVoiceSection';

beforeEach(() => {
  window.localStorage.clear();
});

describe('DovedeVoiceSection', () => {
  it('показує всі фрази з групами й порожній підсумок; Whisper більше немає', () => {
    render(<DovedeVoiceSection />);
    expect(screen.getByRole('heading', { name: 'Голос' })).toBeInTheDocument();
    expect(screen.getByText('Як доїхати з паперової фабрики до вокзалу')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Записати/ })).toHaveLength(41);
    expect(screen.queryByText(/Whisper|Завантажити модель/)).toBeNull();
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
