import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { formatListingContactDisplay, listingContactHref } from '@/utils/constants';
import { maskSenderNameForDisplay } from '@/utils/nameMask';
import type { ComposeOutcome, PoputkaRide } from '../compose/types';

type Poputky = Extract<ComposeOutcome, { kind: 'poputky' }>;

/** «08:20-08:30» → ['08:20', '08:30']; «18:00» → ['18:00', null] */
function splitTime(time: string | null): [string, string | null] | null {
  if (!time) return null;
  const [from, to] = time.split('-').map((x) => x.trim());
  return [from, to || null];
}

/** «380501234567» → «+380 50 123 45 67»; Telegram і незвичні номери — як на дошці сайту */
export function slipNumber(contact: string): string {
  const digits = contact.replace(/\D/g, '');
  const m = /^380(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if (contact.trim().startsWith('@') || !m) return formatListingContactDisplay(contact);
  return `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}

/**
 * Відривний корінець з номером — як на паперовому оголошенні. Номера в розмітці немає: він приходить окремим
 * запитом, коли людина «відриває» корінець (той самий GET /viber-listings/:id/contact, що й на дошці сайту),
 * і стає посиланням «подзвонити». Поки запит іде, корінець смикається; не вдалося — лишається на місці.
 */
export function TearOffContact({ listingId }: { listingId: number }) {
  const [contact, setContact] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'pulling' | 'failed'>('idle');

  const tear = async () => {
    if (state === 'pulling' || contact) return;
    setState('pulling');
    try {
      const r = await apiClient.getViberListingContact(listingId);
      // короткий відгук у долоні там, де телефон це вміє
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(12);
      setContact(r.contact);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  if (contact) {
    const telegram = contact.trim().startsWith('@');
    const shown = slipNumber(contact);
    return (
      <div className="dv-tear dv-tear--off">
        <a className="dv-tear__slip" href={listingContactHref(contact)} {...(telegram ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          <span className="dv-tear__do">{telegram ? 'Написати в Telegram' : 'Подзвонити'}</span>
          <span className="dv-tear__num" aria-label={shown}>
            {[...shown].map((ch, i) => (
              <span key={i} aria-hidden="true" style={{ '--dv-k': i } as CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
        </a>
      </div>
    );
  }

  return (
    <div className={`dv-tear${state === 'pulling' ? ' is-pulling' : ''}`}>
      <button type="button" className="dv-tear__slip" onClick={tear} disabled={state === 'pulling'}>
        <span className="dv-tear__do">{state === 'pulling' ? 'Відриваю…' : state === 'failed' ? 'Не відірвалось — ще раз' : 'Відірвати номер'}</span>
        <span className="dv-tear__num dv-tear__num--masked" aria-hidden="true">
          +380 •• ••• •• ••
        </span>
      </button>
    </div>
  );
}

function Note({ ride, n }: { ride: PoputkaRide; n: number }) {
  const time = splitTime(ride.time);
  const name = ride.name ? maskSenderNameForDisplay(ride.name) : 'Водій';
  return (
    <li className="dv-ad" style={{ '--dv-n': n } as CSSProperties}>
      <span className="dv-ad__pin" aria-hidden="true" />
      <div className="dv-ad__paper">
        <div className="dv-ad__head">
          {time ? (
            <span className="dv-ad__time">
              {time[0]}
              {time[1] ? <small>–{time[1]}</small> : null}
            </span>
          ) : (
            <span className="dv-ad__time dv-ad__time--none">час не вказано</span>
          )}
          <span className="dv-ad__who">{name}</span>
        </div>
        {ride.seats || ride.priceUah ? (
          <div className="dv-ad__stamps">
            {ride.seats ? <span className="dv-ad__stamp">місць: {ride.seats}</span> : null}
            {ride.priceUah ? <span className="dv-ad__stamp">{ride.priceUah} грн</span> : null}
          </div>
        ) : null}
        {ride.notes ? <p className="dv-ad__text">{ride.notes}</p> : null}
      </div>
      <TearOffContact listingId={ride.id} />
    </li>
  );
}

/**
 * Попутки на день як дошка оголошень (Docs/dovede-roadmap.md): кожне оголошення водія — паперова записка на
 * шпильці з відривним корінцем. Час, місця, ціна й примітка — як написав водій; імʼя скорочене, як на дошці сайту.
 */
export function PoputkyCard({ info, dateLabel }: { info: Poputky; dateLabel: string }) {
  const none = info.rides.length === 0;
  return (
    <section className="dv-board" aria-label={`Попутки ${info.fromLabel} — ${info.toLabel}, ${dateLabel}`}>
      <header className="dv-board__plate">
        <span className="dv-board__kind">Попутки</span>
        <span className="dv-board__route">
          {info.fromLabel} → {info.toLabel}
        </span>
        <span className="dv-board__date">{dateLabel}</span>
      </header>
      {info.notice ? <p className="dv-board__sticky">{info.notice}</p> : null}
      {none ? (
        <p className="dv-board__empty">На цей день оголошень від водіїв поки немає.</p>
      ) : (
        <ul className="dv-board__notes">
          {info.rides.map((r, i) => (
            <Note key={r.id} ride={r} n={i} />
          ))}
        </ul>
      )}
      <footer className="dv-board__foot">
        {info.more > 0 || info.passengers > 0 ? (
          <p className="dv-board__caption">
            {[info.more > 0 ? `ще ${info.more} на дошці` : null, info.passengers > 0 ? `шукають попутку: ${info.passengers}` : null].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <Link className="dv-board__all" to={info.boardUrl}>
          {none ? 'Відкрити дошку попуток →' : 'Уся дошка попуток →'}
        </Link>
      </footer>
    </section>
  );
}
