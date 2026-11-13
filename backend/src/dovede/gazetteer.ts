/**
 * Словник місць «Доведе» (Docs/dovede-roadmap.md, «Словник місць»). Основа для Малина — вузли схеми
 * (`scheme/malyn-scheme-nodes.ts`); синоніми — українські відмінки, російська, транслит. Порядок важливий:
 * конкретніші основи стоять раніше («житомирськ» перед «житомир», «малинівк» перед «малин»).
 * У фазі 2 той самий список іде в системний промпт Claude, тому id стабільні.
 */
export type PlaceCity = 'Kyiv' | 'Malyn' | 'Zhytomyr' | 'Korosten' | 'Irpin' | 'Bucha';

export interface GazetteerPlace {
  id: string;
  city: PlaceCity;
  /** коротко, без міста: «Святошин», «вокзал» */
  label: string;
  /** нормалізовані початки слів (див. normalize.ts) */
  stems: string[];
  /** слова, що мають збігтися повністю (короткі: «Київ-Пас.» → «пас») */
  exact?: string[];
  /** місцевий відмінок міста («у Києві») — уточнює вже назване місце, а не задає нове */
  locative?: string[];
  isCity?: boolean;
  /** зупинки міського транспорту Малина; перша — головна */
  stopIds?: string[];
}

export const CITY_LABEL: Record<PlaceCity, string> = {
  Kyiv: 'Київ',
  Malyn: 'Малин',
  Zhytomyr: 'Житомир',
  Korosten: 'Коростень',
  Irpin: 'Ірпінь',
  Bucha: 'Буча',
};

export const PLACES: GazetteerPlace[] = [
  // Київ — точки посадки й метро (київського транспорту в даних немає, лише підказки)
  { id: 'kyiv.zhytomyrska', city: 'Kyiv', label: 'м. Житомирська', stems: ['житомирськ', 'житомирск'] },
  { id: 'kyiv.sviatoshyn', city: 'Kyiv', label: 'Святошин', stems: ['святош', 'sviatosh', 'svyatosh'] },
  { id: 'kyiv.akadem', city: 'Kyiv', label: 'Академмістечко', stems: ['академ', 'akadem'] },
  { id: 'kyiv.borshch', city: 'Kyiv', label: 'Борщагівка', stems: ['борщаг'] },
  { id: 'kyiv.pas', city: 'Kyiv', label: 'вокзал', stems: ['пасажирськ', 'пассажирск', 'вокзальн'], exact: ['пас'] },
  // Малин
  { id: 'malyn.malynivskyi-krug', city: 'Malyn', label: 'Малинівський круг', stems: ['малинівськ', 'малиновск'], stopIds: ['st_0054', 'st_0082'] },
  { id: 'malyn.malynivka', city: 'Malyn', label: 'Малинівка', stems: ['малинівк', 'малиновк'], stopIds: ['st_0053'] },
  { id: 'malyn.avtostantsiya', city: 'Malyn', label: 'автостанція', stems: ['автостанц', 'автовокзал'], stopIds: ['st_0004', 'st_0005'] },
  { id: 'malyn.vokzal', city: 'Malyn', label: 'вокзал', stems: ['вокзал', 'залізничн', 'железнодор'], stopIds: ['st_0019'] },
  { id: 'malyn.tsentr', city: 'Malyn', label: 'центр', stems: ['центр', 'промін', 'базар', 'соборн'], stopIds: ['st_0049', 'st_0070', 'st_0056', 'st_0044'] },
  { id: 'malyn.ptl', city: 'Malyn', label: 'ПТЛ', stems: ['птл', 'пту'], stopIds: ['st_0079', 'st_0048'] },
  { id: 'malyn.likarnia', city: 'Malyn', label: 'лікарня', stems: ['лікарн', 'больниц', 'полікл', 'поликл'], stopIds: ['st_0035', 'st_0036', 'st_0072'] },
  { id: 'malyn.tsarske', city: 'Malyn', label: 'Царське село', stems: ['царськ', 'царск'], stopIds: ['st_0090'] },
  { id: 'malyn.yurivka', city: 'Malyn', label: 'Юрівка', stems: ['юрівк', 'юровк'], stopIds: ['st_0099'] },
  { id: 'malyn.paperova', city: 'Malyn', label: 'Паперова фабрика', stems: ['паперов', 'бумажн'], stopIds: ['st_0064'] },
  { id: 'malyn.hrushevskoho', city: 'Malyn', label: 'Грушевського', stems: ['грушевськ', 'грушевск'], stopIds: ['st_0013', 'st_0042'] },
  { id: 'malyn.barmina', city: 'Malyn', label: 'Барміна', stems: ['бармін', 'бармин'], stopIds: ['st_0007'] },
  { id: 'malyn.lisotekhnikum', city: 'Malyn', label: 'Лісотехнікум', stems: ['лісотехн', 'лесотехн'], stopIds: ['st_0038'] },
  { id: 'malyn.prozhektor', city: 'Malyn', label: 'з-д «Прожектор»', stems: ['прожектор'], stopIds: ['st_0015', 'st_0046'] },
  // Міста коридорів
  { id: 'city.Zhytomyr', city: 'Zhytomyr', label: 'Житомир', stems: ['житомир', 'zhytomyr'], isCity: true },
  { id: 'city.Korosten', city: 'Korosten', label: 'Коростень', stems: ['коростен', 'korosten'], isCity: true },
  { id: 'city.Irpin', city: 'Irpin', label: 'Ірпінь', stems: ['ірпін', 'ирпен', 'irpin'], isCity: true },
  { id: 'city.Bucha', city: 'Bucha', label: 'Буча', stems: ['буча', 'бучі', 'бучу', 'буче', 'bucha'], isCity: true },
  { id: 'city.Malyn', city: 'Malyn', label: 'Малин', stems: ['малин', 'malyn', 'malin'], isCity: true, locative: ['малині', 'малине'] },
  { id: 'city.Kyiv', city: 'Kyiv', label: 'Київ', stems: ['київ', 'києв', 'киев', 'кієв', 'kyiv', 'kiev', 'кив'], isCity: true, locative: ['києві', 'киеве'] },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

export function placeById(id: string): GazetteerPlace | undefined {
  return BY_ID.get(id);
}

/** «Київ · Святошин», «Малин» */
export function placeLabel(place: GazetteerPlace): string {
  return place.isCity ? place.label : `${CITY_LABEL[place.city]} · ${place.label}`;
}

export function findPlaceByToken(normalized: string): GazetteerPlace | undefined {
  return PLACES.find((p) => p.exact?.includes(normalized) || p.stems.some((s) => normalized.startsWith(s)));
}
