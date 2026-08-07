import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
} from '@/pages/SupportPage/supportContent';

type PhraseLink = { phrase: string; to: string; external?: boolean };

/**
 * Довші фрази першими — regex бере перший збіг у альтернативі.
 * Текст AEO / JSON-LD не змінюємо: у UI лише обгортаємо ту саму фразу в Link.
 */
const PHRASE_LINKS: PhraseLink[] = [
  { phrase: 'malin.kiev.ua/support/prices', to: '/support/prices' },
  { phrase: 'malin.kiev.ua/mizhgorodski', to: '/mizhgorodski' },
  { phrase: 'malin.kiev.ua/transport', to: '/transport' },
  { phrase: '/support/prices', to: '/support/prices' },
  { phrase: '/support/travel', to: '/support/travel' },
  { phrase: '/mizhgorodski/kyiv-malyn', to: '/mizhgorodski/kyiv-malyn' },
  { phrase: '/mizhgorodski/malyn-kyiv', to: '/mizhgorodski/malyn-kyiv' },
  { phrase: '/mizhgorodski/zhytomyr-malyn', to: '/mizhgorodski/zhytomyr-malyn' },
  { phrase: '/mizhgorodski/malyn-zhytomyr', to: '/mizhgorodski/malyn-zhytomyr' },
  { phrase: '/mizhgorodski/korosten-malyn', to: '/mizhgorodski/korosten-malyn' },
  { phrase: '/mizhgorodski/malyn-korosten', to: '/mizhgorodski/malyn-korosten' },
  { phrase: '/mizhgorodski', to: '/mizhgorodski' },
  { phrase: '/transport/stop', to: '/transport/stop' },
  { phrase: '/transport', to: '/transport' },
  { phrase: 'сторінку Київ — Малин', to: '/mizhgorodski/kyiv-malyn' },
  { phrase: 'напрямок Київ — Малин', to: '/mizhgorodski/kyiv-malyn' },
  { phrase: 'сторінку Малин — Коростень', to: '/mizhgorodski/malyn-korosten' },
  { phrase: 'Сторінка Малин — Коростень', to: '/mizhgorodski/malyn-korosten' },
  { phrase: 'сторінку Коростень — Малин', to: '/mizhgorodski/korosten-malyn' },
  { phrase: 'Житомир → Малин', to: '/mizhgorodski/zhytomyr-malyn' },
  { phrase: 'статті «Як доїхати до Малина»', to: '/support/travel' },
  { phrase: 'сторінці міжміських', to: '/mizhgorodski' },
  { phrase: 'пошуку на malin.kiev.ua', to: '/mizhgorodski' },
  { phrase: 'пошук на malin.kiev.ua', to: '/mizhgorodski' },
  { phrase: 'картках на malin.kiev.ua', to: '/mizhgorodski' },
  { phrase: 'наприклад Київ — Малин', to: '/mizhgorodski/kyiv-malyn' },
  { phrase: `@${TELEGRAM_BOT_USERNAME}`, to: TELEGRAM_BOT_URL, external: true },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PHRASE_PATTERN = new RegExp(
  PHRASE_LINKS.map((p) => escapeRegExp(p.phrase)).join('|'),
  'g'
);

const PHRASE_TO_LINK = new Map(PHRASE_LINKS.map((p) => [p.phrase, p]));

/**
 * Рендер FAQ/AEO-рядка: той самий текст, що в JSON-LD, плюс клікабельні фрази.
 */
export function FaqAnswerText({ text }: { text: string }): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  PHRASE_PATTERN.lastIndex = 0;

  while ((match = PHRASE_PATTERN.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const phrase = match[0];
    const link = PHRASE_TO_LINK.get(phrase);
    if (link?.external) {
      nodes.push(
        <a key={key++} href={link.to} target="_blank" rel="noopener noreferrer">
          {phrase}
        </a>
      );
    } else if (link) {
      nodes.push(
        <Link key={key++} to={link.to}>
          {phrase}
        </Link>
      );
    } else {
      nodes.push(phrase);
    }
    last = match.index + phrase.length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  if (nodes.length === 0) return text;
  if (nodes.length === 1 && typeof nodes[0] === 'string') return nodes[0];
  return nodes;
}
