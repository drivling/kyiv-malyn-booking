/**
 * Вузли схеми маршрутів (/transport/scheme). ЗГЕНЕРОВАНО — не редагувати руками:
 *   python3 Docs/malyn-transit-scheme/build_scheme.py --site-dir frontend/src/pages/LocalTransportPage/scheme
 * Вузол = кілька фізичних зупинок датасету (NODE_STOPS у генераторі, ревізія — --suggest-node-stops):
 * id — головна зупинка (data-stop у SVG, посилання на табло), stopIds — усі зупинки вузла.
 */
export type SchemeNodeKind = 'hub' | 'terminal' | 'waypoint';
export type SchemeNode = {
  /** Головна зупинка вузла — data-stop у SVG */
  id: string;
  kind: SchemeNodeKind;
  /** Підпис на схемі */
  name: string;
  /** Усі зупинки датасету, що належать вузлу (головна перша) */
  stopIds: string[];
};

export const SCHEME_NODES: SchemeNode[] = [
  {
    "id": "st_0035",
    "kind": "hub",
    "name": "Лікарня · Поліклініка",
    "stopIds": [
      "st_0035",
      "st_0036",
      "st_0072"
    ]
  },
  {
    "id": "st_0070",
    "kind": "hub",
    "name": "Центр · Базарна площа",
    "stopIds": [
      "st_0070",
      "st_0082",
      "st_0008",
      "st_0056",
      "st_0049",
      "st_0044"
    ]
  },
  {
    "id": "st_0054",
    "kind": "hub",
    "name": "Малинівський круг",
    "stopIds": [
      "st_0054"
    ]
  },
  {
    "id": "st_0019",
    "kind": "hub",
    "name": "Залізничний вокзал",
    "stopIds": [
      "st_0019"
    ]
  },
  {
    "id": "st_0038",
    "kind": "terminal",
    "name": "Лісотехнікум",
    "stopIds": [
      "st_0038"
    ]
  },
  {
    "id": "st_0097",
    "kind": "terminal",
    "name": "Шевченка, 119",
    "stopIds": [
      "st_0097",
      "st_0067"
    ]
  },
  {
    "id": "st_0064",
    "kind": "terminal",
    "name": "Паперова фабрика",
    "stopIds": [
      "st_0064"
    ]
  },
  {
    "id": "st_0094",
    "kind": "terminal",
    "name": "Чорновола, 53",
    "stopIds": [
      "st_0094",
      "st_0093"
    ]
  },
  {
    "id": "st_0009",
    "kind": "terminal",
    "name": "вул. Олекси Тихого",
    "stopIds": [
      "st_0009"
    ]
  },
  {
    "id": "st_0004",
    "kind": "waypoint",
    "name": "Автостанція · Укр. Повстанців",
    "stopIds": [
      "st_0004",
      "st_0005"
    ]
  },
  {
    "id": "st_0013",
    "kind": "waypoint",
    "name": "Грушевського",
    "stopIds": [
      "st_0013"
    ]
  },
  {
    "id": "st_0015",
    "kind": "waypoint",
    "name": "з-д «Прожектор»",
    "stopIds": [
      "st_0015",
      "st_0046"
    ]
  },
  {
    "id": "st_0090",
    "kind": "waypoint",
    "name": "Царське село",
    "stopIds": [
      "st_0090"
    ]
  },
  {
    "id": "st_0053",
    "kind": "waypoint",
    "name": "Малинівка",
    "stopIds": [
      "st_0053"
    ]
  },
  {
    "id": "st_0099",
    "kind": "waypoint",
    "name": "Юрівка",
    "stopIds": [
      "st_0099"
    ]
  },
  {
    "id": "st_0079",
    "kind": "waypoint",
    "name": "ПТЛ",
    "stopIds": [
      "st_0079",
      "st_0059"
    ]
  },
  {
    "id": "st_0002",
    "kind": "waypoint",
    "name": "Городище · 14 ОМБ",
    "stopIds": [
      "st_0002",
      "st_0003"
    ]
  },
  {
    "id": "st_0057",
    "kind": "waypoint",
    "name": "вул. Миру",
    "stopIds": [
      "st_0057"
    ]
  },
  {
    "id": "st_0024",
    "kind": "waypoint",
    "name": "Івана Мазепи",
    "stopIds": [
      "st_0024",
      "st_0043"
    ]
  },
  {
    "id": "st_0075",
    "kind": "waypoint",
    "name": "Приходька",
    "stopIds": [
      "st_0075"
    ]
  },
  {
    "id": "st_0007",
    "kind": "waypoint",
    "name": "Барміна",
    "stopIds": [
      "st_0007",
      "st_0092"
    ]
  }
];
