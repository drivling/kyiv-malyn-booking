import type React from 'react';
import { AbsoluteFill, Freeze, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { beats } from '../../brand/beat';
import { GOLOS } from '../../brand/fonts';
import type { Placed } from '../timeline';

/**
 * Старий світ (script.md, A) — стилізації без брендів: жодних логотипів, назв і фірмових кольорів пошуковиків,
 * месенджерів чи транспортних застосунків. Впізнаються за патерном: рядок пошуку й видача з рекламою, десять
 * вкладок, група на 999+ повідомлень, старий застосунок «Ваше місто не підтримується», цитата з інтерв'ю.
 * Вигадані адреси — на `.example` (зарезервований домен), імена в чаті вигадані, номер замаскований.
 */
const SANS = 'Arial, Helvetica, sans-serif';
const QUERY = 'як доїхати з києва в малин';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const Lens: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 20 20">
    <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="#9aa0a6" strokeWidth="2" />
    <path d="M13 13l4.5 4.5" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** A1 — рядок пошуку: запит набирається швидко, курсор блимає */
export const A1: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const typed = QUERY.slice(0, Math.round(clamp01(frame / (shot.dur * 0.8)) * QUERY.length));
  const caret = Math.floor(frame / 8) % 2 === 0;
  return (
    <AbsoluteFill style={{ background: '#ffffff', fontFamily: SANS, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 920, display: 'flex', alignItems: 'center', gap: 26, border: '3px solid #dfe1e5', borderRadius: 999, padding: '34px 44px', boxShadow: '0 6px 18px rgba(32,33,36,.12)', fontSize: 52, color: '#202124' }}>
        <Lens size={52} />
        <span>
          {typed}
          <span style={{ display: 'inline-block', width: 4, height: 58, marginLeft: 4, verticalAlign: -8, background: '#202124', opacity: caret ? 1 : 0 }} />
        </span>
      </div>
      <div style={{ display: 'flex', gap: 30, marginTop: 50 }}>
        {['Пошук', 'Мені пощастить'].map((b) => (
          <span key={b} style={{ background: '#f1f3f4', color: '#3c4043', fontSize: 36, padding: '22px 38px', borderRadius: 10 }}>
            {b}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const RESULTS: [boolean, string, string, string][] = [
  [true, 'kvytky-bus.example', 'Квитки Київ — Малин від 199 ₴ — купити онлайн', 'Найнижчі ціни! Оплата карткою. Розклад може змінюватися.'],
  [true, 'top-pereviznyky.example', 'ТОП-10 перевізників 2019 року', 'Рейтинг перевізників. Відгуки, телефони, акції.'],
  [false, 'rozklad-avtobusiv.example', 'Розклад автобусів Малин (оновлено 2019)', 'Уточнюйте розклад за телефоном диспетчера…'],
  [false, 'forum.example', 'Як доїхати до Малина? — Форум', 'Підкажіть, хто знає, звідки йде маршрутка? Відповідей: 47'],
  [true, 'taksi-malyn.example', 'Таксі Київ — Малин. Фіксована ціна', 'Подача за 15 хвилин. Дзвоніть!'],
  [false, 'misto-info.example', 'Транспорт Малина — довідник', 'Сторінку не знайдено або її було видалено.'],
  [false, 'dosky-ogoloshen.example', 'Попутка Київ Малин — оголошення', 'Оголошення застаріло. Схожі оголошення: 0'],
  [true, 'avtovokzal-kvytky.example', 'Автовокзал онлайн — усі рейси України', 'Рейсів на обрану дату не знайдено.'],
];

/** A2 — видача з рекламою летить угору, а вкладок стає десять */
export const A2: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const p = frame / shot.dur;
  const tabs = 1 + Math.min(9, Math.floor(p * 12));
  const scroll = interpolate(p, [0.1, 1], [0, 1300], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#ffffff', fontFamily: SANS }}>
      {/* видача прокручується під шапкою (вкладки + рядок пошуку) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, bottom: 0, overflow: 'hidden' }}>
        <div style={{ padding: '30px 56px', display: 'grid', gap: 58, transform: `translateY(${-scroll}px)`, filter: `blur(${clamp01((p - 0.35) * 2) * 2.5}px)` }}>
          {RESULTS.map(([ad, url, title, desc]) => (
            <div key={url} style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 30, color: '#4d5156' }}>
                {ad ? <b style={{ color: '#202124', marginRight: 14 }}>Реклама</b> : null}
                {url}
              </div>
              <div style={{ fontSize: 46, color: '#1a0dab', lineHeight: 1.2 }}>{title}</div>
              <div style={{ fontSize: 32, color: '#4d5156', lineHeight: 1.35 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'relative', background: '#dee1e6', padding: '120px 18px 0', display: 'flex', gap: 6, overflow: 'hidden' }}>
        {Array.from({ length: tabs }, (_, i) => (
          <div key={i} style={{ flex: '1 1 0', minWidth: 0, background: i === tabs - 1 ? '#ffffff' : '#eef0f3', borderRadius: '16px 16px 0 0', padding: '18px 14px', display: 'flex', gap: 10, alignItems: 'center', fontSize: 26, color: '#3c4043', whiteSpace: 'nowrap' }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: ['#c9ced6', '#e0c3a8', '#b9d3c4', '#c9c0de'][i % 4], flex: 'none' }} />
            {tabs <= 4 ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>як доїхати…</span> : null}
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', background: '#ffffff', height: 112, padding: '0 44px', borderBottom: '2px solid #ebebeb', display: 'flex', alignItems: 'center', gap: 20, fontSize: 40, color: '#202124' }}>
        <Lens size={40} />
        {QUERY}
      </div>
    </AbsoluteFill>
  );
};

const CHAT: [string, string, boolean?][] = [
  ['Оксана', 'Хто завтра зранку на Київ?'],
  ['Петро', '+'],
  ['Ігор', 'в лс'],
  ['', 'ще актуально??', true],
  ['Наталя', 'а з Малинівки заберете?'],
  ['Василь', 'є 2 місця о 7, тел +380 •• ••• •• ••'],
  ['Оксана', 'ау'],
  ['Юрій', '+'],
];

/** A3 — група попуток: лічильник летить до 999+, повідомлення сиплються на кожен пів біта */
export const A3: React.FC<{ shot: Placed }> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = 1 + Math.floor(frame / beats(0.5));
  const count = Math.round(interpolate(frame, [0, 24], [214, 999], { extrapolateRight: 'clamp' }));
  return (
    <AbsoluteFill style={{ background: '#e7ddd3', fontFamily: SANS }}>
      <div style={{ background: '#6f5a8a', color: '#fff', padding: '130px 44px 36px', display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ width: 96, height: 96, borderRadius: '50%', background: '#b9a6d1', color: '#4a3966', display: 'grid', placeItems: 'center', fontSize: 44, fontWeight: 700 }}>П</div>
        <div>
          <div style={{ fontSize: 46, fontWeight: 700 }}>Попутки Малин ⇄ Київ</div>
          <div style={{ fontSize: 30, opacity: 0.85 }}>12 480 учасників</div>
        </div>
        <div style={{ marginLeft: 'auto', background: '#e53935', borderRadius: 999, padding: '10px 26px', fontSize: 40, fontWeight: 700 }}>{count >= 999 ? '999+' : count}</div>
      </div>
      <div style={{ position: 'absolute', left: 36, right: 36, bottom: 760, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {CHAT.slice(0, shown).map(([name, text, me], i) => {
          const k = spring({ frame: frame - i * beats(0.5), fps, config: { damping: 14, mass: 0.5 } });
          return (
            <div
              key={i}
              style={{
                alignSelf: me ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                background: me ? '#e2f5cf' : '#ffffff',
                borderRadius: me ? '28px 28px 8px 28px' : '28px 28px 28px 8px',
                padding: '18px 28px',
                fontSize: 38,
                lineHeight: 1.3,
                boxShadow: '0 3px 8px rgba(0,0,0,.08)',
                opacity: clamp01(k * 1.4),
                transform: `translateY(${(1 - k) * 40}px) scale(${0.9 + 0.1 * k})`,
              }}
            >
              {name ? <div style={{ fontSize: 26, fontWeight: 700, color: '#8b6fb0', marginBottom: 4 }}>{name}</div> : null}
              {text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** A4 — старий застосунок у дусі 2010-х (глянець, «льон», таблиця) і вікно «Ваше місто не підтримується» */
export const A4: React.FC<{ shot: Placed }> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - beats(1), fps, config: { damping: 9, mass: 0.6 } });
  const shake = frame > beats(1) + 8 && frame < beats(1) + 16 ? Math.sin(frame * 2.4) * 10 : 0;
  return (
    <AbsoluteFill style={{ background: 'repeating-linear-gradient(90deg, #c7cbd1 0 3px, #cdd1d7 3px 6px)', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div style={{ height: 250, paddingTop: 140, background: 'linear-gradient(#a9b6c6, #6d7f97)', borderBottom: '4px solid #4c5a6c', textAlign: 'center', color: '#fff', fontSize: 54, fontWeight: 700, textShadow: '0 -3px 0 rgba(0,0,0,.4)' }}>Транспорт</div>
      <div style={{ margin: '50px 40px', background: '#fff', borderRadius: 24, border: '2px solid #a8b0ba', overflow: 'hidden' }}>
        {['Київ', 'Львів', 'Одеса', 'Харків', 'Дніпро'].map((c) => (
          <div key={c} style={{ padding: '34px 40px', fontSize: 46, fontWeight: 700, color: '#222', borderBottom: '2px solid #e0e3e7', display: 'flex', justifyContent: 'space-between' }}>
            {c}
            <span style={{ color: '#9aa3ad' }}>›</span>
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 110,
          right: 110,
          top: 760,
          borderRadius: 30,
          border: '5px solid rgba(255,255,255,.7)',
          background: 'linear-gradient(rgba(70, 88, 130, .97), rgba(32, 46, 84, .97))',
          color: '#fff',
          textAlign: 'center',
          padding: '54px 44px 40px',
          boxShadow: '0 20px 60px rgba(0,0,0,.45)',
          opacity: clamp01(pop * 1.5),
          transform: `translateX(${shake}px) scale(${0.6 + 0.4 * pop})`,
        }}
      >
        <div style={{ fontSize: 50, fontWeight: 700, marginBottom: 18 }}>Ваше місто не підтримується</div>
        <div style={{ fontSize: 38, opacity: 0.9, marginBottom: 40 }}>Спробуйте вибрати інше місто зі списку.</div>
        <div style={{ borderRadius: 20, border: '4px solid rgba(255,255,255,.5)', background: 'linear-gradient(rgba(255,255,255,.35), rgba(255,255,255,.08))', padding: 24, fontSize: 46, fontWeight: 700 }}>OK</div>
      </div>
    </AbsoluteFill>
  );
};

const QUOTE = '«Стояв на зупинці й не знав, який автобус чекати»';

/** A5 — цитата з інтерв'ю MALYN.MEDIA: слова з'являються одне за одним */
export const A5: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const words = QUOTE.split(' ');
  const per = (shot.dur * 0.6) / words.length;
  return (
    <AbsoluteFill style={{ background: '#0b1416', color: '#f4f8f9', justifyContent: 'center', padding: '0 90px', fontFamily: GOLOS }}>
      <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.12 }}>
        {words.map((w, i) => (
          <span key={i} style={{ opacity: clamp01((frame - i * per) / 4), marginRight: '0.25em', display: 'inline-block' }}>
            {w}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 44, fontSize: 34, letterSpacing: '0.08em', color: '#8fa6ab', opacity: clamp01((frame - shot.dur * 0.55) / 6) }}>MALYN.MEDIA · 07.10.2026</div>
    </AbsoluteFill>
  );
};

/** A6 — райзер: старий світ миготить по 3 кадри, наприкінці — біла вспишка в слоган */
export const A6: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const stills: [React.FC<{ shot: Placed }>, number][] = [
    [A1, 26],
    [A2, 30],
    [A3, 40],
    [A4, 40],
  ];
  const [Comp, at] = stills[Math.floor(frame / 3) % stills.length];
  const flash = clamp01((frame - (shot.dur - 9)) / 8);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${1 + 0.04 * (frame % 3)})` }}>
        <Freeze frame={at}>
          <Comp shot={{ ...shot, dur: 43 }} />
        </Freeze>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: '#ffffff', opacity: flash }} />
    </AbsoluteFill>
  );
};
