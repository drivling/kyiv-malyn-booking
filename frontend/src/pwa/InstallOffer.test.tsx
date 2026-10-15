import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InstallOffer } from './InstallOffer';

describe('InstallOffer: картка встановлення (Docs/transport-pwa-2026-10.md)', () => {
  it('iPhone: іконка застосунку, навіщо, і три кроки з назвами кнопок Safari', () => {
    render(<InstallOffer kind="ios-hint" />);
    expect(screen.getByRole('region', { name: 'Встановлення застосунку' })).toBeInTheDocument();
    expect(screen.getByText('Встановіть «Як доїхати» на телефон')).toBeInTheDocument();
    expect(screen.getByRole('presentation')).toHaveAttribute('src', '/icons/yak-doikhaty-192.png'); // alt="" — декоративна
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('«Поділитися»');
    expect(steps[0]).toHaveTextContent('внизу екрана Safari');
    expect(steps[1]).toHaveTextContent('«На Початковий екран»');
    expect(steps[2]).toHaveTextContent('«Додати»');
    expect(screen.queryByRole('button', { name: 'Встановити' })).toBeNull();
  });

  it('Android без події: меню ⋮ → «Додати на головний екран»', () => {
    render(<InstallOffer kind="android-hint" />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('⋮');
    expect(steps[1]).toHaveTextContent('«Додати на головний екран»');
  });

  it('Chromium з подією: кнопка «Встановити», без кроків', () => {
    render(<InstallOffer kind="prompt" />);
    expect(screen.getByRole('button', { name: 'Встановити' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('хрестик ховає картку на місяць (localStorage з часом)', () => {
    render(<InstallOffer kind="ios-hint" />);
    fireEvent.click(screen.getByRole('button', { name: 'Приховати на місяць' }));
    const stored = Number(localStorage.getItem('transport-install-hint'));
    expect(stored).toBeGreaterThan(Date.now() - 5_000);
  });
});
