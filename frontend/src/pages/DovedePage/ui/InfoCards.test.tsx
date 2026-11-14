/** Довідкові відповіді «Доведе»: чек із цінами й оголошення з телефонами перевізника. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ZUBASTYK_PHONES } from '@/pages/MizhgorodskiPage/zubastykContent';
import { ContactCard, PriceCard } from './InfoCards';

describe('чек «скільки коштує»', () => {
  it('рядок на кожну ціну; чого в даних немає — так і надруковано', () => {
    render(
      <PriceCard
        lines={[
          { label: 'Маршрутка Київ ↔ Малин', price: '310 грн', note: 'за місце, в один бік' },
          { label: 'Міський автобус Малина', price: null, note: 'одна поїздка' },
        ]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Маршрутка Київ ↔ Малин');
    expect(rows[0]).toHaveTextContent('310 грн');
    expect(rows[0]).toHaveTextContent('за місце, в один бік');
    expect(rows[1]).toHaveTextContent('немає даних');
    expect(screen.getByText(/Уточнюйте у перевізника/)).toBeInTheDocument();
  });
});

describe('оголошення з телефонами', () => {
  it('кожен корінець — посилання «подзвонити» на номер із сайту; резервний підписано', () => {
    render(
      <MemoryRouter>
        <ContactCard />
      </MemoryRouter>,
    );
    for (const p of ZUBASTYK_PHONES) {
      expect(screen.getByRole('link', { name: new RegExp(p.label) })).toHaveAttribute('href', `tel:+${p.digits}`);
    }
    expect(screen.getByText('резервний')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Інші питання — у довідці →' })).toHaveAttribute('href', '/support');
  });
});
