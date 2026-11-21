/**
 * «Доведе» · голос: числа, сказані словами, → цифри (Docs/dovede-voice-roadmap.md, Ф1·1).
 *
 * Словник сторінки (`parseLocal`) розуміє «о 6-й», «після 14», «Хрещатик 22», але не «о шостій», «після
 * чотирнадцятої», «двадцять два»: у набраному тексті так пишуть рідко, а розпізнавання мови чує саме слова. Без цього
 * кроку помилка словника виглядала б як помилка розпізнавання. Тут — чиста функція; коли лабораторія покаже, що
 * вона потрібна, її місце — перед `parseLocal` на сторінці (Ф1·2).
 */

const UNITS: Record<string, number> = {
  один: 1, одна: 1, одне: 1, одну: 1, два: 2, дві: 2, три: 3, чотири: 4, "п'ять": 5, шість: 6, сім: 7, вісім: 8, "дев'ять": 9,
  десять: 10, одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14, "п'ятнадцять": 15, шістнадцять: 16, сімнадцять: 17,
  вісімнадцять: 18, "дев'ятнадцять": 19,
};
const TENS: Record<string, number> = { двадцять: 20, тридцять: 30, сорок: 40, "п'ятдесят": 50, шістдесят: 60, сімдесят: 70, вісімдесят: 80, "дев'яносто": 90 };

/** Основи порядкових 1–20 (шост-, сьом-…): «шоста / шостій / шостої / шосту / шостого / шостий» */
const ORDINAL_STEMS: Record<string, number> = {
  перш: 1, друг: 2, трет: 3, четверт: 4, "п'ят": 5, шост: 6, сьом: 7, восьм: 8, "дев'ят": 9, десят: 10, одинадцят: 11, дванадцят: 12,
  тринадцят: 13, чотирнадцят: 14, "п'ятнадцят": 15, шістнадцят: 16, сімнадцят: 17, вісімнадцят: 18, "дев'ятнадцят": 19, двадцят: 20,
};
/** жіночий рід: «о шостій», «до шостої», «на шосту», «шоста» — так годину називають за годинником */
const FEM_ENDINGS = ['а', 'ій', 'ої', 'у', 'ою'];
/** чоловічий / середній: «крім одинадцятого», «другий маршрут» */
const MASC_ENDINGS = ['ий', 'ого', 'ому', 'им', 'ім', 'е'];

/** Прийменники, після яких жіночий порядковий — майже напевно година */
const STRONG_PREPS = new Set(['о', 'об', 'опів', 'близько', 'біля', 'приблизно', 'рівно', 'десь']);
/** Ці — лише коли далі нічого або слово часу («до шостої ранку»), бо «до другої лікарні» — не година */
const WEAK_PREPS = new Set(['до', 'після', 'на', 'від', 'з', 'по', 'к', 'коло', 'зі']);
const TIME_CONTEXT = new Set([
  'ранку', 'зранку', 'вранці', 'вечора', 'ввечері', 'дня', 'вдень', 'ночі', 'вночі', 'годині', 'години', 'годин', 'завтра', 'сьогодні', 'післязавтра', 'і', 'та', 'а', 'але', 'крім', 'чи', 'на', 'до', 'з', 'від', 'в', 'у', 'маршруткою', 'електричкою', 'попуткою', 'автобусом',
]);

type Tok = { lead: string; core: string; trail: string };

function split(text: string): Tok[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(w)!;
      return { lead: m[1], core: m[2], trail: m[3] };
    });
}

const norm = (s: string): string => s.toLowerCase().replace(/[ʼ’`]/g, "'");

/** «шостій» → 6; `form` — рід закінчення, яке підійшло */
function ordinal(word: string, endings: string[]): number | null {
  const w = norm(word);
  for (const [stem, n] of Object.entries(ORDINAL_STEMS)) {
    if (!w.startsWith(stem)) continue;
    const tail = w.slice(stem.length);
    if (endings.includes(tail)) return n;
  }
  return null;
}

/** «двадцять» + «першій» → 21 (години 21–23) */
function hourAt(toks: Tok[], i: number): { hour: number; len: number } | null {
  if (i >= toks.length) return null;
  if (norm(toks[i].core) === 'двадцять' && i + 1 < toks.length) {
    const u = ordinal(toks[i + 1].core, FEM_ENDINGS);
    if (u && u <= 3) return { hour: 20 + u, len: 2 };
  }
  const h = ordinal(toks[i].core, FEM_ENDINGS);
  return h && h <= 24 ? { hour: h, len: 1 } : null;
}

function isTimeContext(toks: Tok[], i: number): boolean {
  return i >= toks.length || TIME_CONTEXT.has(norm(toks[i].core)) || /^\d/.test(toks[i].core);
}

function timesToDigits(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const w = norm(t.core);
    // «пів на восьму» / «опів на восьму» → 7:30
    if ((w === 'пів' || w === 'опів') && i + 2 < toks.length && norm(toks[i + 1].core) === 'на') {
      const h = hourAt(toks, i + 2);
      if (h) {
        const last = toks[i + 1 + h.len + 0];
        const half = ((h.hour + 23) % 24) || 24;
        out.push({ lead: t.lead, core: `${half === 24 ? 0 : half}:30`, trail: last.trail });
        i += 1 + h.len;
        continue;
      }
    }
    const strong = STRONG_PREPS.has(w);
    const weak = WEAK_PREPS.has(w);
    if (strong || weak) {
      const h = hourAt(toks, i + 1);
      if (h && (strong || isTimeContext(toks, i + 1 + h.len))) {
        const last = toks[i + h.len];
        out.push(t, { lead: toks[i + 1].lead, core: `${h.hour}:00`, trail: last.trail });
        i += h.len;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/** «крім одинадцятого», «другий маршрут» → «крім 11», «2 маршрут» */
function routeOrdinalsToDigits(toks: Tok[]): Tok[] {
  return toks.map((t, i) => {
    const n = ordinal(t.core, MASC_ENDINGS);
    if (n === null) return t;
    const prev = i > 0 ? norm(toks[i - 1].core) : '';
    const next = i + 1 < toks.length ? norm(toks[i + 1].core) : '';
    return prev === 'крім' || next.startsWith('маршрут') ? { ...t, core: String(n) } : t;
  });
}

function cardinalsToDigits(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const w = norm(toks[i].core);
    let value: number | null = null;
    let len = 0;
    if (w in TENS) {
      value = TENS[w];
      len = 1;
      const nxt = i + 1 < toks.length ? norm(toks[i + 1].core) : '';
      if (nxt in UNITS && UNITS[nxt] < 10) {
        value += UNITS[nxt];
        len = 2;
      }
    } else if (w in UNITS) {
      value = UNITS[w];
      len = 1;
    }
    if (value === null) {
      out.push(toks[i]);
      continue;
    }
    const last = toks[i + len - 1];
    let core = String(value);
    let trail = last.trail;
    let used = len;
    // «двадцять вісім а» → «28а» (літера будинку), «сім дріб один» → «7/1»
    const after = toks[i + used];
    if (after && !last.trail && /^[абвгд]$/i.test(after.core)) {
      core += after.core.toLowerCase();
      trail = after.trail;
      used += 1;
    } else if (after && !last.trail && norm(after.core) === 'дріб' && toks[i + used + 1] && norm(toks[i + used + 1].core) in UNITS) {
      core += `/${UNITS[norm(toks[i + used + 1].core)]}`;
      trail = toks[i + used + 1].trail;
      used += 2;
    }
    out.push({ lead: toks[i].lead, core, trail });
    i += used - 1;
  }
  return out;
}

/** «о шостій», «двадцять два», «сім дріб один» → «о 6:00», «22», «7/1». Решту тексту не чіпає. */
export function spokenNumbersToDigits(text: string): string {
  const toks = cardinalsToDigits(routeOrdinalsToDigits(timesToDigits(split(text))));
  return toks.map((t) => `${t.lead}${t.core}${t.trail}`).join(' ');
}
