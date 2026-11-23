/**
 * Джура · відновлення історії чату: HTML «як у Telegram» з експорту /admin/dzhura/chats/:id/export.
 * Чисті функції (без браузера): render.mjs відкриває сторінку в Chromium і знімає картки.
 *
 * Режими: single — одне повідомлення = одна картинка; chunk — шматок розмови = «скріншот телефона»
 * (розбиває браузер, бо висоту знає лише він); text — HTML-текст для Telegram (кілька повідомлень у пості).
 */

export const KYIV_TZ = 'Europe/Kyiv';
/** Сусідні повідомлення одного автора в межах 10 хв — одна група (ім'я над першим, аватар біля останнього) */
export const GROUP_GAP_MS = 10 * 60 * 1000;
/** Ширина картки в CSS-пікселях; знімаємо з deviceScaleFactor 2 → 720 px */
export const CARD_WIDTH = 360;
/** Найбільша висота «скріншота»: 640 × 2 = 1280 px — більший бік фото, яке Telegram показує без стиснення */
export const PAGE_MAX_HEIGHT = 640;
/** Ліміт тексту повідомлення Telegram — 4096; беремо із запасом на розмітку */
export const TEXT_POST_LIMIT = 3800;

/** Кольори імен і аватарок Telegram (порядок: червоний, помаранчевий, фіолетовий, зелений, бірюзовий, синій, рожевий) */
const PEER_COLORS = [
  { name: '#cc5049', from: '#ff845e', to: '#d45246' },
  { name: '#d67722', from: '#febb5b', to: '#f68136' },
  { name: '#955cdb', from: '#b694f9', to: '#6c61df' },
  { name: '#40a920', from: '#9ad164', to: '#46ba43' },
  { name: '#309eba', from: '#53edd6', to: '#28c9b7' },
  { name: '#368ad1', from: '#5caffa', to: '#408acf' },
  { name: '#c7508b', from: '#ff8aac', to: '#d95574' },
];

const MEDIA_LABEL = {
  photo: { icon: '📷', label: 'Фото' },
  video: { icon: '🎬', label: 'Відео' },
  video_note: { icon: '⏺', label: 'Відеоповідомлення' },
  voice: { icon: '🎤', label: 'Голосове повідомлення' },
  audio: { icon: '🎵', label: 'Аудіо' },
  sticker: { icon: '🙂', label: 'Стікер' },
  gif: { icon: '🎞', label: 'GIF' },
  document: { icon: '📄', label: 'Файл' },
  contact: { icon: '👤', label: 'Контакт' },
  geo: { icon: '📍', label: 'Геопозиція' },
  poll: { icon: '📊', label: 'Опитування' },
  other: { icon: '📎', label: 'Вкладення' },
};

/** Медіа, що займає весь верх бульбашки (як фото), а не рядок з іконкою */
const BLOCK_MEDIA = new Set(['photo', 'video', 'gif']);

export function peerColor(tgUserId) {
  let n = 0;
  try {
    n = Number(BigInt(String(tgUserId ?? '0')) % 7n);
  } catch {
    n = 0;
  }
  return PEER_COLORS[(n + 7) % 7];
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LINK_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]»])|((?:^|(?<=[\s(]))@[A-Za-z0-9_]{4,32})|((?:^|(?<=[\s(]))#[\p{L}\p{N}_]{2,64})/gu;

/** Текст повідомлення → HTML: екранування, посилання / @згадки / #теги синім, як у Telegram */
export function textHtml(text) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(LINK_RE)) {
    out += escapeHtml(src.slice(last, m.index));
    out += `<span class="link">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(src.slice(last));
}

export function initials(name) {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '…';
  const a = [...words[0]][0] ?? '';
  const b = words.length > 1 ? ([...words[1]][0] ?? '') : '';
  return (a + b).toUpperCase();
}

const timeFmt = new Intl.DateTimeFormat('uk-UA', { timeZone: KYIV_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('uk-UA', { timeZone: KYIV_TZ, day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('uk-UA', { timeZone: KYIV_TZ, day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('uk-UA', {
  timeZone: KYIV_TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const kyivTime = (iso) => timeFmt.format(new Date(iso));
export const kyivDayKey = (iso) => dayKeyFmt.format(new Date(iso));

/** «4 листопада»; рік — лише коли він не поточний (як у Telegram) */
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  const sameYear = dayKeyFmt.format(d).slice(0, 4) === dayKeyFmt.format(now).slice(0, 4);
  return (sameYear ? dayFmt : dayYearFmt).format(d).replace(/\s*р\.$/, '');
}

export function mediaInfo(kind) {
  return kind ? (MEDIA_LABEL[kind] ?? MEDIA_LABEL.other) : null;
}

/** Посилання з прев'ю Telegram зберігає як media «other» — тоді вкладення не малюємо, лишається текст */
export function showsMedia(m) {
  if (!m.mediaKind) return false;
  if (m.mediaKind === 'other' && /https?:\/\//.test(m.text ?? '')) return false;
  return true;
}

/** Короткий текст для цитати відповіді / підпису */
export function snippet(m, max = 90) {
  const t = String(m?.text ?? '').replace(/\s+/g, ' ').trim();
  if (t) return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  const info = showsMedia(m ?? {}) ? mediaInfo(m.mediaKind) : null;
  return info ? info.label : 'Повідомлення';
}

/** Хто переслав: ім'я з Telegram або з нашого журналу за id */
export function forwardName(fwd, personsById) {
  if (!fwd) return null;
  if (fwd.name) return fwd.name;
  const p = fwd.tgId ? personsById.get(String(fwd.tgId)) : null;
  if (p) return [p.firstName, p.lastName].filter(Boolean).join(' ') || (p.username ? `@${p.username}` : null);
  return null;
}

/** Реакції {"❤": 9, "custom:1": 2, "paid": 1} → [{emoji, count}], найчастіші першими */
export function reactionList(counts) {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts)
    .map(([k, v]) => ({
      emoji: k === 'paid' ? '⭐' : k.startsWith('custom:') ? '✨' : k,
      count: Number(v) || 0,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Спільний контекст: повідомлення за tgMessageId (для цитат), люди за tgUserId (для переслань), аватарки */
export function buildContext(exports, avatars = {}) {
  const byId = new Map();
  const personsById = new Map();
  for (const ex of exports) {
    for (const p of ex.persons ?? []) personsById.set(String(p.tgUserId), p);
    for (const m of ex.messages ?? []) byId.set(String(m.tgMessageId), m);
  }
  return { byId, personsById, avatars };
}

function avatarHtml(sender, ctx) {
  const id = String(sender?.tgUserId ?? '');
  const photo = ctx.avatars[id];
  if (photo) return `<div class="ava"><img src="data:image/jpeg;base64,${photo}" alt=""></div>`;
  const c = peerColor(id);
  return `<div class="ava" style="background:linear-gradient(${c.from},${c.to})"><span>${escapeHtml(initials(sender?.name))}</span></div>`;
}

function replyHtml(m, ctx) {
  if (!m.replyToTgMessageId) return '';
  const target = ctx.byId.get(String(m.replyToTgMessageId));
  if (!target) {
    return `<div class="reply" style="--c:#8a99a8"><b>Відповідь</b><span>повідомлення не збереглося</span></div>`;
  }
  const c = peerColor(target.sender?.tgUserId);
  return `<div class="reply" style="--c:${c.name}"><b>${escapeHtml(target.sender?.name ?? '')}</b><span>${escapeHtml(snippet(target))}</span></div>`;
}

function mediaHtml(m) {
  if (!showsMedia(m)) return '';
  const info = mediaInfo(m.mediaKind);
  if (BLOCK_MEDIA.has(m.mediaKind)) {
    return `<div class="media-block"><span class="mi">${info.icon}</span><span class="ml">${info.label} не збереглося</span></div>`;
  }
  return `<div class="media-row"><span class="mr-ico">${info.icon}</span><span class="mr-txt"><b>${info.label}</b><small>не збереглося</small></span></div>`;
}

/**
 * Один рядок чату: аватар-колонка + бульбашка. Ім'я й аватар/хвостик вмикають класи .first/.last
 * (їх ставить розкладка, бо групи залежать від того, що опинилося поруч на картці).
 */
export function rowHtml(m, ctx) {
  const c = peerColor(m.sender?.tgUserId);
  const fwdName = m.forward ? forwardName(m.forward, ctx.personsById) : null;
  const fwd = m.forward
    ? `<div class="fwd">${fwdName ? `Переслано від <b>${escapeHtml(fwdName)}</b>` : 'Переслане повідомлення'}</div>`
    : '';
  const reacts = reactionList(m.reactionsCounts);
  const time = `${m.editedAt ? '<i>змінено</i> ' : ''}${kyivTime(m.sentAt)}`;
  const hasText = Boolean(String(m.text ?? '').trim());
  const media = mediaHtml(m);
  const onlyBlock = !hasText && media.startsWith('<div class="media-block"') && !reacts.length;
  const spacer = `<span class="spacer${m.editedAt ? ' wide' : ''}"></span>`;
  const body = hasText ? `<div class="text">${textHtml(m.text)}${reacts.length ? '' : spacer}</div>` : '';
  const reactsHtml = reacts.length
    ? `<div class="reacts">${reacts.map((r) => `<span class="re">${escapeHtml(r.emoji)}<b>${r.count}</b></span>`).join('')}${spacer}</div>`
    : '';
  const tailOnly = !hasText && !reacts.length && !onlyBlock ? spacer : '';
  return `<div class="row" data-sender="${escapeHtml(String(m.sender?.tgUserId ?? ''))}" data-day="${kyivDayKey(m.sentAt)}" data-day-label="${escapeHtml(dayLabel(m.sentAt))}" data-ts="${Date.parse(m.sentAt)}" data-id="${escapeHtml(String(m.tgMessageId))}">
  <div class="ava-col">${avatarHtml(m.sender, ctx)}</div>
  <div class="bubble${onlyBlock ? ' only-media' : ''}">
    <div class="name" style="color:${c.name}">${escapeHtml(m.sender?.name ?? '')}</div>
    ${fwd}${replyHtml(m, ctx)}${media}${body}${reactsHtml}${tailOnly}
    <div class="time${onlyBlock ? ' over' : ''}">${time}</div>
  </div>
</div>`;
}

export const PAGE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: -apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased; color: #000; }
#src { position: absolute; left: -10000px; top: 0; width: ${CARD_WIDTH}px; }
.card { width: ${CARD_WIDTH}px; padding: 8px 0 10px; margin: 0 0 20px;
  background: #b8cf9d linear-gradient(160deg, #d3dcae 0%, #a8c99b 38%, #9cc39a 55%, #c6d59c 100%); }
.pill { display: flex; justify-content: center; margin: 4px 0 8px; }
.pill span { background: rgba(37, 64, 42, .32); color: #fff; font-size: 13px; font-weight: 600;
  padding: 3px 10px; border-radius: 12px; }
.row { display: flex; align-items: flex-end; padding: 0 8px 0 6px; margin-top: 2px; }
.row.first { margin-top: 7px; }
.ava-col { width: 36px; flex: 0 0 36px; display: flex; align-items: flex-end; }
.ava { width: 33px; height: 33px; border-radius: 50%; overflow: hidden; display: flex; align-items: center;
  justify-content: center; color: #fff; font-weight: 600; font-size: 13.5px; visibility: hidden; }
.ava img { width: 100%; height: 100%; object-fit: cover; display: block; }
.row.last .ava { visibility: visible; }
.bubble { position: relative; background: #fff; border-radius: 14px; padding: 5px 9px 6px; max-width: 284px;
  min-width: 64px; box-shadow: 0 1px 1px rgba(0, 0, 0, .13); margin-left: 4px; }
.row.last .bubble { border-bottom-left-radius: 4px; }
.row.last .bubble::before { content: ''; position: absolute; left: -9px; bottom: 0; width: 10px; height: 16px;
  background: radial-gradient(circle at 0 0, transparent 9.5px, #fff 10px); }
.name { display: none; font-size: 14px; font-weight: 600; line-height: 1.25; margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.first .name { display: block; }
.text { font-size: 15px; line-height: 1.33; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
.link { color: #168acd; }
.spacer { display: inline-block; width: 40px; height: 1px; }
.spacer.wide { width: 92px; }
.time { position: absolute; right: 8px; bottom: 4px; font-size: 11.5px; color: #8e9aa6; white-space: nowrap; }
.time i { font-style: normal; }
.fwd { font-size: 13.5px; color: #2f87c8; line-height: 1.3; margin-bottom: 3px; }
.fwd b { font-weight: 600; }
.reply { border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 10%, white);
  border-radius: 5px; padding: 2px 7px 3px; margin: 1px 0 4px; font-size: 13.5px; line-height: 1.28;
  display: flex; flex-direction: column; overflow: hidden; }
.reply b { color: var(--c); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #222; }
.media-block { margin: 2px -5px 5px; height: 128px; border-radius: 10px; background: linear-gradient(135deg, #e4ebf1, #cfdae4);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #6c7f90; min-width: 200px; }
.only-media { padding: 4px; }
.only-media .media-block { margin: 0; }
.media-block .mi { font-size: 30px; }
.media-block .ml { font-size: 13px; }
.time.over { background: rgba(0, 0, 0, .35); color: #fff; border-radius: 9px; padding: 1px 6px; right: 9px; bottom: 9px; }
.media-row { display: flex; align-items: center; gap: 9px; margin: 2px 0 4px; min-width: 210px; }
.mr-ico { width: 42px; height: 42px; border-radius: 50%; background: #e3eefa; display: flex; align-items: center;
  justify-content: center; font-size: 20px; flex: 0 0 42px; }
.mr-txt { display: flex; flex-direction: column; font-size: 14.5px; line-height: 1.25; }
.mr-txt b { font-weight: 600; }
.mr-txt small { font-size: 12.5px; color: #8e9aa6; }
.reacts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; align-items: center; }
.re { display: inline-flex; align-items: center; gap: 4px; background: #e3eefa; color: #1f7fd0; border-radius: 14px;
  padding: 2px 9px 2px 7px; font-size: 14px; line-height: 1.35; }
.re b { font-size: 13px; font-weight: 600; }
`;

/**
 * Розкладка в браузері: групи, дати, а в режимі chunk — нарізка на «скріншоти» ≤ PAGE_MAX_HEIGHT.
 * Виконується через page.evaluate(layout, {mode, maxHeight, gapMs}).
 */
export function layout({ mode, maxHeight, gapMs }) {
  const src = document.getElementById('src');
  const rows = [...src.querySelectorAll(':scope > .row')];
  const regroup = (card) => {
    card.querySelectorAll('.pill').forEach((p) => p.remove());
    const rs = [...card.querySelectorAll('.row')];
    rs.forEach((r, i) => {
      const prev = rs[i - 1];
      const next = rs[i + 1];
      const joins = (a, b) =>
        a && b && a.dataset.sender === b.dataset.sender && a.dataset.day === b.dataset.day &&
        Math.abs(Number(b.dataset.ts) - Number(a.dataset.ts)) <= gapMs;
      r.classList.toggle('first', !joins(prev, r));
      r.classList.toggle('last', !joins(r, next));
      if (!prev || prev.dataset.day !== r.dataset.day) {
        const pill = document.createElement('div');
        pill.className = 'pill';
        pill.innerHTML = `<span>${r.dataset.dayLabel}</span>`;
        r.before(pill);
        if (prev) r.classList.add('first');
      }
    });
  };
  const newCard = () => {
    const c = document.createElement('div');
    c.className = 'card';
    document.body.appendChild(c);
    return c;
  };
  const cards = [];
  if (mode === 'single') {
    let prevDay = null;
    for (const r of rows) {
      const c = newCard();
      c.appendChild(r);
      regroup(c);
      if (prevDay === r.dataset.day) c.querySelectorAll('.pill').forEach((p) => p.remove());
      prevDay = r.dataset.day;
      cards.push(c);
    }
  } else {
    let c = newCard();
    cards.push(c);
    for (const r of rows) {
      c.appendChild(r);
      regroup(c);
      if (c.offsetHeight > maxHeight && c.querySelectorAll('.row').length > 1) {
        r.remove();
        regroup(c);
        c = newCard();
        cards.push(c);
        c.appendChild(r);
        regroup(c);
      }
    }
  }
  return cards.map((c, i) => {
    c.id = `card-${i}`;
    const ids = [...c.querySelectorAll('.row')].map((r) => r.dataset.id);
    return { id: c.id, ids, height: c.offsetHeight };
  });
}

export function pageHtml(messages, ctx) {
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head>
<body><div id="src">${messages.map((m) => rowHtml(m, ctx)).join('\n')}</div></body></html>`;
}

/** Підпис до картинки-шматка: «4 листопада, 18:17–18:39» */
export function rangeCaption(first, last) {
  const a = kyivTime(first.sentAt);
  const b = kyivTime(last.sentAt);
  const sameDay = kyivDayKey(first.sentAt) === kyivDayKey(last.sentAt);
  if (sameDay) return `${dayLabel(first.sentAt)}, ${a === b ? a : `${a}–${b}`}`;
  return `${dayLabel(first.sentAt)}, ${a} — ${dayLabel(last.sentAt)}, ${b}`;
}

/** Текстовий режим: одне повідомлення → HTML-блок для Telegram (parse_mode html) */
export function textBlock(m, ctx) {
  const head = `<b>${escapeHtml(m.sender?.name ?? '')}</b> · ${escapeHtml(shortFmt.format(new Date(m.sentAt)))}`;
  const lines = [head];
  if (m.forward) {
    const n = forwardName(m.forward, ctx.personsById);
    lines.push(`<i>${n ? `переслано від ${escapeHtml(n)}` : 'переслане повідомлення'}</i>`);
  }
  if (m.replyToTgMessageId) {
    const t = ctx.byId.get(String(m.replyToTgMessageId));
    lines.push(
      t
        ? `<i>↪ ${escapeHtml(t.sender?.name ?? '')}: «${escapeHtml(snippet(t, 60))}»</i>`
        : '<i>↪ відповідь на повідомлення, що не збереглося</i>',
    );
  }
  if (showsMedia(m)) lines.push(`<i>[${mediaInfo(m.mediaKind).label.toLowerCase()} не збереглося]</i>`);
  const text = String(m.text ?? '');
  const maxText = TEXT_POST_LIMIT - 600;
  if (text.trim()) lines.push(escapeHtml(text.length > maxText ? `${text.slice(0, maxText - 1)}…` : text));
  const reacts = reactionList(m.reactionsCounts);
  if (reacts.length) lines.push(reacts.map((r) => `${r.emoji} ${r.count}`).join('  '));
  return lines.join('\n');
}

/** Текстові пости: блоки повідомлень, склеєні до TEXT_POST_LIMIT символів */
export function textPosts(messages, ctx, limit = TEXT_POST_LIMIT) {
  const posts = [];
  let cur = [];
  let len = 0;
  for (const m of messages) {
    const block = textBlock(m, ctx);
    if (cur.length && len + 2 + block.length > limit) {
      posts.push(cur.join('\n\n'));
      cur = [];
      len = 0;
    }
    cur.push(block);
    len += block.length + 2;
  }
  if (cur.length) posts.push(cur.join('\n\n'));
  return posts;
}
