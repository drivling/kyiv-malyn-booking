/**
 * «Доведе» в Коростені — місця для словника в браузері й для промпту Claude (Docs/dovede-roadmap.md, «Коростень»).
 * Файл байт-у-байт однаковий у frontend/src/pages/DovedePage/korosten/korostenPlaces.ts і
 * backend/src/dovede/korostenPlaces.ts (тест фронтенду їх порівнює) — правити обидва. Нічого не імпортує: так однакові
 * й шляхи.
 */

export interface KorostenStopLike {
  id: string;
  name: string;
}

/**
 * Народні й короткі назви зупинок Коростеня → id зупинки. Лише очевидні з назв зупинок і розкладу ради, без
 * вигаданих орієнтирів. Кожна фраза — слова назви в називному відмінку (відмінки ловить `wordMatchesName`: «пашини» →
 * «з Пашин», «грозине» → «на Грозиного»); слово до 4 літер порівнюється цілком, тому «суд» / «суду» — окремо.
 */
export const KOROSTEN_ALIASES: Array<{ stopId: string; phrases: string[] }> = [
  { stopId: 'st_1001', phrases: ['вокзал', 'залізничний вокзал', 'жд вокзал'] },
  { stopId: 'st_1002', phrases: ['ринок', 'ринку', 'ринка', 'базар', 'базару', 'базарі', 'центральний ринок'] },
  { stopId: 'st_1003', phrases: ['центр', 'центру', 'центрі'] },
  { stopId: 'st_1069', phrases: ['гастелло', 'шухевича'] },
  { stopId: 'st_1079', phrases: ['міськлікарня', 'міська лікарня'] },
  { stopId: 'st_1073', phrases: ['районна лікарня', 'залізнична лікарня'] },
  { stopId: 'st_1085', phrases: ['поліклініка'] },
  { stopId: 'st_1010', phrases: ['чолівка', 'переїзд'] },
  { stopId: 'st_1080', phrases: ['автопарк'] },
  { stopId: 'st_1049', phrases: ['житомирська станція', 'станція житомирська'] },
  { stopId: 'st_1031', phrases: ['подільський', 'коростень подільський'] },
  { stopId: 'st_1015', phrases: ['водосховище', 'поліське'] },
  { stopId: 'st_1048', phrases: ['білокоровицьке'] },
  { stopId: 'st_1061', phrases: ['цегельний', 'цегельня'] },
  { stopId: 'st_1037', phrases: ['швейна'] },
  { stopId: 'st_1016', phrases: ['парк', 'древлянський', 'островського'] },
  { stopId: 'st_1055', phrases: ['стадіон', 'локомотив'] },
  { stopId: 'st_1104', phrases: ['виконком', 'міськвиконком'] },
  { stopId: 'st_1038', phrases: ['суд', 'суду', 'суді', 'дім правосуддя'] },
  { stopId: 'st_1043', phrases: ['діагностичний'] },
];

/** Назва зупинки без уточнень у дужках — як `stopBaseName` у nlu/stopPlaces.ts */
export function korostenBaseName(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Технічні точки геометрії маршруту («№5 т.3») — не зупинки для людей */
export function isKorostenPassengerStop(s: KorostenStopLike): boolean {
  return !s.name.trim().startsWith('№');
}

/**
 * Місця Коростеня: пасажирські зупинки з однаковою назвою (обидва боки дороги) — одне місце; id місця — найменший
 * id його зупинок. Цим id словник у браузері й Claude називають місце однаково.
 */
export function korostenStopGroups(stops: KorostenStopLike[]): Array<{ id: string; label: string; stopIds: string[] }> {
  const byBase = new Map<string, string[]>();
  for (const s of [...stops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!isKorostenPassengerStop(s)) continue;
    const base = korostenBaseName(s.name);
    if (!base) continue;
    byBase.set(base, [...(byBase.get(base) ?? []), s.id]);
  }
  return [...byBase].map(([label, stopIds]) => ({ id: stopIds[0], label, stopIds }));
}
