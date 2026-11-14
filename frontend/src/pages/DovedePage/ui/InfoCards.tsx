import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ZUBASTYK_PHONES } from '@/pages/MizhgorodskiPage/zubastykContent';
import type { PriceLine } from '../compose/types';

/**
 * «Скільки коштує» — касовий чек, що виїжджає зі щілини принтера: рядки «назва ..... ціна», рваний нижній край.
 * Цифри — з розкладу сайту й тарифу міста (compose/priceOutcome); чого в даних немає, так і надруковано.
 */
export function PriceCard({ lines }: { lines: PriceLine[] }) {
  return (
    <section className="dv-till" aria-label="Скільки коштує проїзд">
      <span className="dv-till__slot" aria-hidden="true" />
      <div className="dv-receipt">
        <header className="dv-receipt__head">
          <strong>Доведе.</strong>
          <span>скільки коштує проїзд</span>
        </header>
        <ul className="dv-receipt__rows">
          {lines.map((l, i) => (
            <li key={l.label} className="dv-receipt__row" style={{ '--dv-n': i } as CSSProperties}>
              <span className="dv-receipt__line">
                <span className="dv-receipt__what">{l.label}</span>
                <span className="dv-receipt__dots" aria-hidden="true" />
                <span className={`dv-receipt__sum${l.price ? '' : ' dv-receipt__sum--none'}`}>{l.price ?? 'немає даних'}</span>
              </span>
              {l.note ? <span className="dv-receipt__note">{l.note}</span> : null}
            </li>
          ))}
        </ul>
        <p className="dv-receipt__foot">Ціни — з розкладу сайту. Уточнюйте у перевізника перед поїздкою.</p>
        <span className="dv-receipt__bars" aria-hidden="true" />
      </div>
    </section>
  );
}

/**
 * «Телефон» — оголошення перевізника на тій самій дошці, що й попутки: записка на шпильці, внизу корінці з
 * номерами. Номери тут відкриті (це телефони бронювання з сайту), тож кожен корінець — одразу посилання «подзвонити».
 */
export function ContactCard() {
  return (
    <section className="dv-board" aria-label="Телефони маршруток Київ — Малин">
      <header className="dv-board__plate">
        <span className="dv-board__kind">Телефони</span>
        <span className="dv-board__route">Київ ↔ Малин</span>
      </header>
      <ul className="dv-board__notes">
        <li className="dv-ad">
          <span className="dv-ad__pin" aria-hidden="true" />
          <div className="dv-ad__paper">
            <div className="dv-ad__head">
              <span className="dv-ad__who dv-ad__who--title">Маршрутки «Зубастик»</span>
            </div>
            <p className="dv-ad__text">Бронювання місць і питання про рейси — за телефоном.</p>
          </div>
          <ul className="dv-tabs">
            {ZUBASTYK_PHONES.map((p) => (
              <li key={p.digits}>
                <a className="dv-tabs__tab" href={`tel:+${p.digits}`}>
                  <span className="dv-tabs__num">{p.label}</span>
                  {p.note ? <span className="dv-tabs__note">{p.note}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </li>
      </ul>
      <footer className="dv-board__foot">
        <Link className="dv-board__all" to="/support">
          Інші питання — у довідці →
        </Link>
      </footer>
    </section>
  );
}
