/**
 * Вузли схеми маршрутів (/transport/scheme). ЗГЕНЕРОВАНО — не редагувати руками:
 *   python3 Docs/malyn-transit-scheme/build_scheme.py --city Docs/korosten-transit-scheme/korosten_scheme.py --site-dir frontend/src/pages/LocalTransportPage/scheme
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
    "id": "st_1001",
    "kind": "hub",
    "name": "Залізничний вокзал",
    "stopIds": [
      "st_1001"
    ]
  },
  {
    "id": "st_1002",
    "kind": "hub",
    "name": "Міський ринок",
    "stopIds": [
      "st_1002"
    ]
  },
  {
    "id": "st_1003",
    "kind": "hub",
    "name": "Центр міста",
    "stopIds": [
      "st_1003"
    ]
  },
  {
    "id": "st_1016",
    "kind": "hub",
    "name": "Парк «Древлянський»",
    "stopIds": [
      "st_1016"
    ]
  },
  {
    "id": "st_1037",
    "kind": "hub",
    "name": "Швейна фабрика",
    "stopIds": [
      "st_1037"
    ]
  },
  {
    "id": "st_1006",
    "kind": "hub",
    "name": "Черемушки",
    "stopIds": [
      "st_1006"
    ]
  },
  {
    "id": "st_1069",
    "kind": "hub",
    "name": "Романа Шухевича",
    "stopIds": [
      "st_1069"
    ]
  },
  {
    "id": "st_1015",
    "kind": "terminal",
    "name": "Поліське водосховище",
    "stopIds": [
      "st_1015"
    ]
  },
  {
    "id": "st_1048",
    "kind": "terminal",
    "name": "Білокоровицьке шосе",
    "stopIds": [
      "st_1048"
    ]
  },
  {
    "id": "st_1087",
    "kind": "terminal",
    "name": "Пашини",
    "stopIds": [
      "st_1087"
    ]
  },
  {
    "id": "st_1036",
    "kind": "terminal",
    "name": "Вул. Проліскова",
    "stopIds": [
      "st_1036"
    ]
  },
  {
    "id": "st_1044",
    "kind": "terminal",
    "name": "Вул. Київська",
    "stopIds": [
      "st_1044"
    ]
  },
  {
    "id": "st_1049",
    "kind": "terminal",
    "name": "Станція Житомирська",
    "stopIds": [
      "st_1049"
    ]
  },
  {
    "id": "st_1061",
    "kind": "terminal",
    "name": "Цегельний завод",
    "stopIds": [
      "st_1061"
    ]
  },
  {
    "id": "st_1076",
    "kind": "terminal",
    "name": "Бровар",
    "stopIds": [
      "st_1076"
    ]
  },
  {
    "id": "st_1068",
    "kind": "terminal",
    "name": "Магазин №44",
    "stopIds": [
      "st_1068"
    ]
  },
  {
    "id": "st_1101",
    "kind": "terminal",
    "name": "Грозине",
    "stopIds": [
      "st_1101"
    ]
  },
  {
    "id": "st_1105",
    "kind": "terminal",
    "name": "Сади",
    "stopIds": [
      "st_1105"
    ]
  },
  {
    "id": "st_1102",
    "kind": "terminal",
    "name": "Дачі УТОС",
    "stopIds": [
      "st_1102"
    ]
  },
  {
    "id": "st_1104",
    "kind": "waypoint",
    "name": "Міськвиконком",
    "stopIds": [
      "st_1104"
    ]
  },
  {
    "id": "st_1079",
    "kind": "waypoint",
    "name": "Міськлікарня",
    "stopIds": [
      "st_1079"
    ]
  },
  {
    "id": "st_1082",
    "kind": "waypoint",
    "name": "Граніт",
    "stopIds": [
      "st_1082"
    ]
  },
  {
    "id": "st_1083",
    "kind": "waypoint",
    "name": "ДУ",
    "stopIds": [
      "st_1083"
    ]
  },
  {
    "id": "st_1085",
    "kind": "waypoint",
    "name": "Районна поліклініка",
    "stopIds": [
      "st_1085"
    ]
  },
  {
    "id": "st_1020",
    "kind": "waypoint",
    "name": "Хіммаш",
    "stopIds": [
      "st_1020"
    ]
  },
  {
    "id": "st_1021",
    "kind": "waypoint",
    "name": "Гастроном",
    "stopIds": [
      "st_1021"
    ]
  },
  {
    "id": "st_1023",
    "kind": "waypoint",
    "name": "Прорізна, 33",
    "stopIds": [
      "st_1023"
    ]
  },
  {
    "id": "st_1025",
    "kind": "waypoint",
    "name": "Фабрика «Ельфа»",
    "stopIds": [
      "st_1025"
    ]
  },
  {
    "id": "st_1027",
    "kind": "waypoint",
    "name": "Вул. Стельмаха",
    "stopIds": [
      "st_1027"
    ]
  },
  {
    "id": "st_1031",
    "kind": "waypoint",
    "name": "Коростень-Подільський",
    "stopIds": [
      "st_1031"
    ]
  },
  {
    "id": "st_1033",
    "kind": "waypoint",
    "name": "Церква",
    "stopIds": [
      "st_1033"
    ]
  },
  {
    "id": "st_1035",
    "kind": "waypoint",
    "name": "Чигирі",
    "stopIds": [
      "st_1035"
    ]
  },
  {
    "id": "st_1005",
    "kind": "waypoint",
    "name": "В. Стуса",
    "stopIds": [
      "st_1005"
    ]
  },
  {
    "id": "st_1007",
    "kind": "waypoint",
    "name": "Ветлікарня",
    "stopIds": [
      "st_1007"
    ]
  },
  {
    "id": "st_1010",
    "kind": "waypoint",
    "name": "Чолівський переїзд",
    "stopIds": [
      "st_1010"
    ]
  },
  {
    "id": "st_1011",
    "kind": "waypoint",
    "name": "Школа №13",
    "stopIds": [
      "st_1011"
    ]
  },
  {
    "id": "st_1013",
    "kind": "waypoint",
    "name": "Селище Мирне",
    "stopIds": [
      "st_1013"
    ]
  },
  {
    "id": "st_1047",
    "kind": "waypoint",
    "name": "КВК №71",
    "stopIds": [
      "st_1047"
    ]
  },
  {
    "id": "st_1064",
    "kind": "waypoint",
    "name": "Школа №1",
    "stopIds": [
      "st_1064"
    ]
  },
  {
    "id": "st_1073",
    "kind": "waypoint",
    "name": "Районна лікарня",
    "stopIds": [
      "st_1073"
    ]
  },
  {
    "id": "st_1053",
    "kind": "waypoint",
    "name": "Шевченка, 117",
    "stopIds": [
      "st_1053"
    ]
  },
  {
    "id": "st_1055",
    "kind": "waypoint",
    "name": "Стадіон «Локомотив»",
    "stopIds": [
      "st_1055"
    ]
  },
  {
    "id": "st_1051",
    "kind": "waypoint",
    "name": "Завод ЗБШ",
    "stopIds": [
      "st_1051"
    ]
  },
  {
    "id": "st_1074",
    "kind": "waypoint",
    "name": "Вул. 1-го Травня",
    "stopIds": [
      "st_1074"
    ]
  },
  {
    "id": "st_1038",
    "kind": "waypoint",
    "name": "Дім правосуддя",
    "stopIds": [
      "st_1038"
    ]
  },
  {
    "id": "st_1041",
    "kind": "waypoint",
    "name": "Трубосталь",
    "stopIds": [
      "st_1041"
    ]
  },
  {
    "id": "st_1043",
    "kind": "waypoint",
    "name": "Діагностичний центр",
    "stopIds": [
      "st_1043"
    ]
  },
  {
    "id": "st_1057",
    "kind": "waypoint",
    "name": "Аптека",
    "stopIds": [
      "st_1057"
    ]
  },
  {
    "id": "st_1063",
    "kind": "waypoint",
    "name": "ПМК",
    "stopIds": [
      "st_1063"
    ]
  },
  {
    "id": "st_1060",
    "kind": "waypoint",
    "name": "Вул. Південна",
    "stopIds": [
      "st_1060"
    ]
  },
  {
    "id": "st_1071",
    "kind": "waypoint",
    "name": "Вул. І. Франка",
    "stopIds": [
      "st_1071"
    ]
  },
  {
    "id": "st_1072",
    "kind": "waypoint",
    "name": "СМП 650",
    "stopIds": [
      "st_1072"
    ]
  }
];
