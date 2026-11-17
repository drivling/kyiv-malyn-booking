/**
 * Станції київської міської електрички (Kyiv City Express) — усі 20, у порядку руху за годинниковою стрілкою від
 * Святошина (Docs/dovede-roadmap.md, «Міська електричка Києва»). Чисті дані без імпортів: файл байт-у-байт той
 * самий у `frontend/src/pages/DovedePage/nlu/` і `backend/src/dovede/` (тест у `kyivRing.test.ts` їх порівнює) —
 * правте обидва.
 *
 * `slug` — назва станції в розкладі (`data/kyivRingTimetable.json`).
 * `metro` — станція метро поруч (id точки Києва) і `walkMin` — скільки пішки між платформою й метро. Така станція
 * в питанні людини лишається місцем метро («Почайна» = `kyiv.m.pochaina`); окремими місцями стають лише станції
 * без метро.
 * `said` — як станцію називають понад офіційну назву (старі, розмовні, російські форми; відмінки дає нормалізація).
 * `strict` — сама назва означає інше (метро «Дарниця» — за два кілометри звідти), тож у питанні станцію дають лише
 * форми з `said`: «вокзал Дарниця», «Дарницький вокзал».
 */
export interface RingStation {
  id: string;
  slug: string;
  name: string;
  said: string[];
  metro?: string;
  walkMin?: number;
  strict?: boolean;
}

const s = (id: string, slug: string, name: string, said: string[] = [], o: { metro?: string; walkMin?: number; strict?: boolean } = {}): RingStation => ({ id, slug, name, said, ...o });

export const RING_STATIONS: RingStation[] = [
  s('kyiv.e.sviatoshyn', 'sviatosin', 'Святошин', [], { metro: 'kyiv.sviatoshyn', walkMin: 4 }),
  s('kyiv.e.beresteiska', 'beresteiska', 'Берестейська', [], { metro: 'kyiv.beresteiska', walkMin: 5 }),
  s('kyiv.e.syrets', 'sirec', 'Сирець', [], { metro: 'kyiv.m.syrets', walkMin: 4 }),
  s('kyiv.e.priorka', 'priorka', 'Пріорка', ['Приорка']),
  s('kyiv.e.kurenivka', 'kurenivka', 'Куренівка', ['Куреневка']),
  s('kyiv.e.pochaina', 'pocaina', 'Почайна', [], { metro: 'kyiv.m.pochaina', walkMin: 3 }),
  s('kyiv.e.raiduzhnyi', 'raiduzna', 'Райдужний', ['Райдужный', 'Райдужний масив']),
  s('kyiv.e.voskresenka', 'voskresenka', 'Воскресенка', []),
  s('kyiv.e.mykilska-slobidka', 'mikilska-slobidka', 'Микільська Слобідка', ['Никольская Слободка', 'Микільська Слобода']),
  s('kyiv.e.livoberezhna', 'livoberezna', 'Лівобережна', [], { metro: 'kyiv.m.livoberezhna', walkMin: 9 }),
  s('kyiv.e.rusanivka', 'rusanivka', 'Русанівка', ['Русановка']),
  s('kyiv.e.darnytsia', 'darnicia', 'Дарниця', ['вокзал Дарниця', 'платформа Дарниця', 'Дарницький вокзал', 'Дарницкий вокзал', 'Дарниця вокзал'], { strict: true }),
  s('kyiv.e.berezniaky', 'berezniaki', 'Березняки', []),
  s('kyiv.e.vydubychi', 'vidubici', 'Видубичі', [], { metro: 'kyiv.m.vydubychi', walkMin: 3 }),
  s('kyiv.e.demiivskyi', 'kiyiv-demiyivskii', 'Київ-Деміївський', ['Киев-Демеевский', 'Київ-Московський', 'Киев-Московский']),
  s('kyiv.e.protasiv-yar', 'protasiv-iar', 'Протасів Яр', ['Протасового Яру', 'Протасовому Яру', 'Протасов Яр']),
  s('kyiv.e.vokzalna', 'vokzalna', 'Вокзальна', [], { metro: 'kyiv.pas', walkMin: 6 }),
  s('kyiv.e.karavaievi-dachi', 'karavajevi-daci', 'Караваєві Дачі', ['Караваевы Дачи', 'Каравайки']),
  s('kyiv.e.volynskyi', 'kiyiv-volinskii', 'Київ-Волинський', ['Киев-Волынский', 'Пост-Волинський', 'Пост-Волынский']),
  // старий id: платформа вже була місцем словника (електричка Київ — Малин тут зупиняється)
  s('kyiv.borshch', 'borshhagivka', 'Борщагівка', ['Борщаговка']),
];
