import { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { SITE_PUBLIC_DOMAIN } from '@/legal/sitePublic';
import {
  LEGACY_HASH_TO_TOPIC,
  SUPPORT_PATH,
  SUPPORT_TOPICS,
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
  supportTopicPath,
} from './supportContent';

function upsertMeta(name: string, content: string): () => void {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  const created = !el;
  const prev = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (prev != null) el.setAttribute('content', prev);
  };
}

/** Хаб help-center: пошук теми + CTA, без довгого скролу всіх статей */
export function SupportHub() {
  const location = useLocation();

  useEffect(() => {
    const prev = document.title;
    document.title = `Допомога | ${SITE_PUBLIC_DOMAIN}`;
    const restoreDesc = upsertMeta(
      'description',
      'Центр допомоги malin.kiev.ua: Telegram-бот, попутки, акція «Приведи друга», FAQ і контакти.'
    );
    return () => {
      document.title = prev;
      restoreDesc();
    };
  }, []);

  const hash = location.hash.replace(/^#/, '');
  if (hash && LEGACY_HASH_TO_TOPIC[hash]) {
    const topic = LEGACY_HASH_TO_TOPIC[hash];
    const anchor =
      hash.startsWith('bot-') && hash !== 'bot-referral' ? `#${hash}` : '';
    return <Navigate to={`${supportTopicPath(topic)}${anchor}`} replace />;
  }

  return (
    <div className="support-hub">
      <header className="support-hub__hero">
        <p className="support-hub__eyebrow">Центр допомоги · {SITE_PUBLIC_DOMAIN}</p>
        <h1 className="support-hub__title">Чим допомогти?</h1>
        <p className="support-hub__lead">
          Оберіть тему — коротка стаття без простирання всієї довідки на один екран. Найчастіше потрібен
          Telegram-бот або відповідь з FAQ.
        </p>
        <div className="support-hub__actions">
          <a
            className="support-btn support-btn--primary"
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Відкрити @{TELEGRAM_BOT_USERNAME}
          </a>
          <Link className="support-btn support-btn--ghost" to={supportTopicPath('bot')}>
            Інструкція по боту
          </Link>
          <Link className="support-btn support-btn--ghost" to={supportTopicPath('contact')}>
            Контакти
          </Link>
        </div>
      </header>

      <ul className="support-hub__grid">
        {SUPPORT_TOPICS.map((t) => (
          <li key={t.id}>
            <Link to={supportTopicPath(t.id)} className="support-hub__card">
              <span className="support-hub__card-title">{t.title}</span>
              <span className="support-hub__card-blurb">{t.blurb}</span>
              <span className="support-hub__card-go">Відкрити →</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="support-hub__foot">
        Повернутися на <Link to={SUPPORT_PATH}>усі теми</Link> можна з будь-якої статті.
      </p>
    </div>
  );
}
