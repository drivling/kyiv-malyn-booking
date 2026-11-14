import { Link } from 'react-router-dom';
import { ZUBASTYK_PHONES } from '@/pages/MizhgorodskiPage/zubastykContent';
import type { PriceLine } from '../compose/types';

/** «Скільки коштує»: ціни з розкладу сайту й тарифу міста */
export function PriceCard({ lines }: { lines: PriceLine[] }) {
  return (
    <div className="dv-card dv-info">
      <div className="dv-card__top">
        <span className="dv-card__title">Скільки коштує</span>
      </div>
      <ul className="dv-info__list">
        {lines.map((l) => (
          <li key={l.label} className="dv-info__row dv-info__row--price">
            <span className="dv-info__body">
              <span className="dv-info__facts">{l.label}</span>
              {l.note ? <span className="dv-meta">{l.note}</span> : null}
            </span>
            <span className="dv-info__price">{l.price ?? 'ціни в моїх даних немає'}</span>
          </li>
        ))}
      </ul>
      <p className="dv-meta">Ціни — з розкладу сайту; уточнюйте у перевізника перед поїздкою.</p>
    </div>
  );
}

/** «Телефон»: куди дзвонити щодо маршруток Київ ↔ Малин; решта — у довідці */
export function ContactCard() {
  return (
    <div className="dv-card dv-info">
      <div className="dv-card__top">
        <span className="dv-card__title">Маршрутки Київ ↔ Малин («Зубастик»)</span>
      </div>
      <p className="dv-meta">Бронювання місць і питання про рейси — за телефоном:</p>
      <ul className="dv-info__list">
        {ZUBASTYK_PHONES.map((p) => (
          <li key={p.digits} className="dv-info__row dv-info__row--price">
            <a className="dv-info__phone" href={`tel:+${p.digits}`}>
              {p.label}
            </a>
            {p.note ? <span className="dv-meta">{p.note}</span> : null}
          </li>
        ))}
      </ul>
      <Link className="dv-btn" to="/support">
        Інші питання — у довідці →
      </Link>
    </div>
  );
}
