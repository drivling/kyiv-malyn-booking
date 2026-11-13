import { Link } from 'react-router-dom';
import { ZUBASTYK_PHONES } from '@/pages/MizhgorodskiPage/zubastykContent';
import type { ComposeOutcome, PriceLine } from '../compose/types';

type Poputky = Extract<ComposeOutcome, { kind: 'poputky' }>;

/**
 * Попутки на день (Docs/dovede-roadmap.md): оголошення водіїв з дошки сайту — час, місця, ціна й примітка так, як
 * написав водій. Телефонів тут немає: контакт людина відкриває на дошці, де діють її правила.
 */
export function PoputkyCard({ info, dateLabel }: { info: Poputky; dateLabel: string }) {
  const none = info.rides.length === 0;
  return (
    <div className="dv-card dv-info">
      <div className="dv-card__top">
        <span className="dv-badge dv-badge--poputka">Попутки</span>
        <span className="dv-card__title">
          {info.fromLabel} → {info.toLabel}
        </span>
      </div>
      <p className="dv-meta">{dateLabel}</p>
      {info.notice ? <p className="dv-info__empty">{info.notice}</p> : null}
      {none ? (
        <p className="dv-info__empty">На цей день оголошень від водіїв поки немає.</p>
      ) : (
        <ul className="dv-info__list">
          {info.rides.map((r) => (
            <li key={r.id} className="dv-info__row">
              <span className="dv-info__time">{r.time ?? 'час не вказано'}</span>
              <span className="dv-info__body">
                <span className="dv-info__facts">
                  {[r.name, r.seats ? `місць: ${r.seats}` : null, r.priceUah ? `${r.priceUah} грн` : null].filter(Boolean).join(' · ') || 'водій'}
                </span>
                {r.notes ? <span className="dv-meta">{r.notes}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {info.more > 0 ? <p className="dv-meta">і ще {info.more} на дошці</p> : null}
      {info.passengers > 0 ? <p className="dv-meta">Шукають попутку цього дня: {info.passengers}.</p> : null}
      <Link className="dv-btn" to={info.boardUrl}>
        {none ? 'Відкрити дошку попуток →' : 'Контакти водіїв — на дошці попуток →'}
      </Link>
    </div>
  );
}

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
