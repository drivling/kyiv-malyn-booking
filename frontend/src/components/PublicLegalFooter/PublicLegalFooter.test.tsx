/**
 * Підвал: звичайний — усі рядки; «під катом» (collapsible, «Доведе») — лише рядок розробника й «Більше».
 */
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router-dom';
import { renderWithProviders, screen } from '@/test/utils';
import { PublicLegalFooter } from './PublicLegalFooter';

const developer = () => screen.getByRole('link', { name: 'ТОВ «Технології»' });

describe('PublicLegalFooter', () => {
  it('звичайний підвал: усі посилання видно, кнопки «Більше» немає', () => {
    renderWithProviders(<PublicLegalFooter />);
    expect(screen.getByRole('link', { name: 'Допомога' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Політика конфіденційності' })).toBeVisible();
    expect(developer()).toHaveAttribute('href', 'https://technologies.llc/');
    expect(screen.queryByRole('button', { name: 'Більше' })).not.toBeInTheDocument();
  });

  it('під катом: лише розробник; «Більше» розгортає все, «Згорнути» ховає знову', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLegalFooter collapsible />);
    expect(developer()).toBeVisible();
    expect(developer().closest('p')).toHaveTextContent(/^Розробник — ТОВ «Технології»\.Більше$/);
    // решта підвалу в DOM, але схована: ні на екрані, ні для читачів екрана
    expect(screen.getByRole('contentinfo').querySelector('[hidden]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Допомога' })).not.toBeInTheDocument();

    const more = screen.getByRole('button', { name: 'Більше' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getByRole('link', { name: 'Допомога' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Умови користування' })).toBeVisible();
    const less = screen.getByRole('button', { name: 'Згорнути' });
    expect(less).toHaveAttribute('aria-expanded', 'true');

    await user.click(less);
    expect(screen.queryByRole('link', { name: 'Допомога' })).not.toBeInTheDocument();
  });

  it('згортається, коли людина друкує в полі поза підвалом, а від кліку деінде — ні', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <input aria-label="Питання" />
        <button type="button">Інша кнопка</button>
        <PublicLegalFooter collapsible />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Більше' }));
    await user.click(screen.getByRole('button', { name: 'Інша кнопка' }));
    expect(screen.getByRole('link', { name: 'Допомога' })).toBeVisible();

    await user.type(screen.getByLabelText('Питання'), 'з');
    expect(screen.queryByRole('link', { name: 'Допомога' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Більше' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('інша адреса (нова відповідь, інша сторінка) — згортається', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Link to="/dovede?t=malyn.vokzal">відповідь</Link>
        <PublicLegalFooter collapsible />
      </>,
      { initialEntries: ['/dovede'] },
    );
    await user.click(screen.getByRole('button', { name: 'Більше' }));
    expect(screen.getByRole('link', { name: 'Допомога' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'відповідь' }));
    expect(screen.queryByRole('link', { name: 'Допомога' })).not.toBeInTheDocument();
  });

  it('Esc у підвалі згортає й повертає фокус на кнопку', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLegalFooter collapsible />);
    await user.click(screen.getByRole('button', { name: 'Більше' }));
    screen.getByRole('link', { name: 'Допомога' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Допомога' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Більше' })).toHaveFocus();
  });
});
