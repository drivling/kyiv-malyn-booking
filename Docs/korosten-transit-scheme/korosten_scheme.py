# Схема міських маршрутів Коростеня — геометрія для спільного генератора:
#   python3 Docs/malyn-transit-scheme/build_scheme.py --city Docs/korosten-transit-scheme/korosten_scheme.py …
# Файл виконується в просторі імен генератора й перевизначає його константи (CITY, N, C, ROUTES, …).
# Вигляд — за авторською схемою власника 2019 року (data/korosten-transport/scheme-2019/), склад ліній — розклад
# Коростенської міської ради 2026: 9 ліній, рейси іншим шляхом — пунктиром. Під-план: Docs/korosten-scheme-2026-11.md.
# ruff: noqa: F821  (re, HTML_TMPL, SITE_*_TS_HEAD — з генератора)

API = 'https://kyiv-malyn-booking-production.up.railway.app/transport/dataset?city=Korosten'

CITY = dict(
    prefix='korosten',
    title_caps='КОРОСТЕНЬ',
    aria='Схема міських автобусних маршрутів Коростеня: 9 ліній, кінцеві та пересадкові зупинки',
    summary='9 маршрутів · схема не в масштабі · показано кінцеві, вузлові й деякі проміжні зупинки · пунктир — окремі рейси іншим шляхом',
    footer='Дані: розклад руху Коростенської міської ради · korosten.kiev.ua/transport · листопад 2026 · за схемою власника сайту 2019 року',
    canvas_h=1400,
    site_view='0 160 1400 970',
    compass_site=(1340, 200),
    legend_y0=1160,
    legend_split=5,
    qr_url='https://korosten.kiev.ua/transport/scheme',
)

ROUTE_ORDER = ['1', '2', '2b', '3', '4', '5', '6', '7', '8']
UNCONFIRMED = set()
# 2-Б — окремий маршрут, але в одному пучку з фіолетовими 2 і 3: біла смуга посередині
STRIPED = {'2b'}


def _lighter(hex_color, k=0.32):
    """Колір лінії для темної теми — світліший на k до білого."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02X%02X%02X' % tuple(round(c + (255 - c) * k) for c in (r, g, b))


# кольори — зі схеми 2019 (meta.routeColors датасету Коростеня, ті самі значення)
_LIGHT = {
    '1': '#E40C1C', '2': '#7440A4', '2b': '#7C6CB4', '3': '#A8A0D4', '4': '#242860',
    '5': '#F02480', '6': '#48BCA8', '7': '#EC60B4', '8': '#F07860',
}
COLORS = {rid: (c, _lighter(c)) for rid, c in _LIGHT.items()}

LEGEND = {
    '1':  ('Залізничний вокзал', 'Поліське водосховище', 'Ринок · Центр · Черемушки · Чолівський переїзд · Школа №13 · Селище Мирне'),
    '2':  ('Залізничний вокзал', 'Пашини', 'Ринок · Парк «Древлянський» · Міськлікарня · ДУ · Районна поліклініка · окремі рейси — до Шухевича'),
    '2b': ('Пашини', 'Романа Шухевича (Гастелло)', 'Районна поліклініка · Парк «Древлянський» · Ринок · Вокзал · Школа №1 · Районна лікарня'),
    '3':  ('Залізничний вокзал', 'Вул. Проліскова', 'Парк «Древлянський» · Хіммаш · Гастроном · Ельфа · Коростень-Подільський · Чигирі'),
    '4':  ('Залізничний вокзал', 'Вул. Київська', 'Ринок · Швейна фабрика · Дім правосуддя · Трубосталь · окремі рейси — Грозине'),
    '5':  ('Залізничний вокзал', 'Білокоровицьке шосе', 'Ринок · Центр · Черемушки · Чолівський переїзд · КВК №71'),
    '6':  ('Станція Житомирська', 'Цегельний завод', 'Шевченка, 117 · Вокзал · Ринок · Дім правосуддя · Аптека · окремі рейси — по Південній'),
    '7':  ('Залізничний вокзал', 'Романа Шухевича (Гастелло)', 'Ринок · Центр · Черемушки · Магазин №44 · окремі рейси — через Франка'),
    '8':  ('Магазин №44', 'Бровар', 'Шухевича · Районна лікарня · Вокзал · Ринок · 1-го Травня · окремі рейси — Сади, Дачі УТОС'),
}

# ---------------------------------------------------------------- геометрія (сітка 45°)
N = {
    # центр: вокзал → ринок, від ринку три віяла
    'VOK': (640, 420), 'RYN': (760, 540), 'CEN': (760, 680), 'PARK': (940, 540), 'SHV': (880, 660),
    # південь і захід: Черемушки, кільце через Шухевича, №1 і №5
    'CHE': (640, 800), 'MAG': (540, 800), 'SHU': (440, 800), 'K1': (440, 620),
    'CHOL': (540, 900), 'POL': (400, 1040), 'BK': (280, 900),
    # №6 на захід
    'W6P': (340, 420), 'ZH': (220, 540),
    # №2 / 2-Б на північ, №3 дугою над вокзалом і петлею Чигирі – Проліскова
    'PASH': (940, 220),
    'G1': (860, 460), 'G2': (860, 320), 'G3': (520, 320), 'G4': (460, 260), 'KP': (460, 200),
    'SHL': (380, 200), 'L1': (340, 240), 'L2': (260, 240), 'CHY': (220, 200), 'PROL': (140, 200),
    # №8 на південь, №4 і №6 на схід
    'BRO': (880, 900), 'SADY': (820, 960), 'UTOS': (940, 960),
    'DP': (980, 760), 'SH4': (1080, 660), 'TRUB': (1160, 660), 'KE1': (1260, 660), 'KYIV': (1260, 760), 'HROZ': (1260, 860),
    'APT': (1060, 840), 'P6A': (1120, 900), 'CEG': (1120, 1000), 'P6B': (1060, 940),
    # №7 через Франка: від Центру на схід і на північ, до вокзалу в обхід ринку
    'F1': (820, 680), 'F2': (820, 390), 'F3': (670, 390),
}
# + = візуально ліворуч від напрямку коридору (у координатах екрана)
C = {
    # пучок вокзал → ринок: угорі ті, що від ринку йдуть на схід, посередині — на південний схід, унизу — на південь
    'T':    (['VOK', 'RYN'],   {'3': 4, '2': 3, '2b': 2, '4': 1, '6': 0, '8': -1, '1': -2, '5': -3, '7': -4}),
    'PK':   (['RYN', 'PARK'],  {'3': 1, '2': 0, '2b': -1}),
    'P2':   (['PARK', 'PASH'], {'2': 0.5, '2b': -0.5}),
    'R3A':  (['PARK', 'G1', 'G2', 'G3', 'G4', 'KP'], {'3': 0}),
    'R3B':  (['KP', 'SHL'],    {'3': 0}),
    'R3L':  (['SHL', 'L1', 'L2', 'CHY'], {'3': 0}),   # туди: через Церкву й Місток
    'R3E':  (['CHY', 'PROL'],  {'3': 0}),
    'R3U':  (['CHY', 'SHL'],   {'3': 0}),             # назад: напряму
    'SV':   (['RYN', 'SHV'],   {'4': 1, '6': 0, '8': -1}),
    'B8':   (['SHV', 'BRO'],   {'8': 0}),
    'R8S':  (['BRO', 'SADY'],  {'8': 0}),
    'R8U':  (['BRO', 'UTOS'],  {'8': 0}),
    'DPC':  (['SHV', 'DP'],    {'4': 0.5, '6': -0.5}),
    'R4':   (['DP', 'SH4', 'TRUB'], {'4': 0}),
    'R4L':  (['TRUB', 'KE1', 'KYIV'], {'4': 0}),      # туди: через Київську 1-А й Діагностичний центр
    'R4B':  (['KYIV', 'TRUB'], {'4': 0}),             # назад: напряму
    'R4H':  (['KYIV', 'HROZ'], {'4': 0}),
    'R6E':  (['DP', 'APT', 'P6A', 'CEG'], {'6': 0}),
    'R6S':  (['APT', 'P6B', 'CEG'], {'6': 0}),        # по Південній
    'W6':   (['ZH', 'W6P', 'VOK'], {'6': 0}),
    'CS':   (['RYN', 'CEN'],   {'1': 1, '5': 0, '7': -1}),
    'CHC':  (['CEN', 'CHE'],   {'1': 1, '5': 0, '7': -1}),
    'CC2':  (['CHE', 'CHOL'],  {'1': 0.5, '5': -0.5}),
    'R1':   (['CHOL', 'POL'],  {'1': 0}),
    'R5':   (['CHOL', 'BK'],   {'5': 0}),
    'CHM':  (['MAG', 'CHE'],   {'7': -0.5}),
    'MS':   (['SHU', 'MAG'],   {'8': 0.5, '7': -0.5}),
    'RG':   (['VOK', 'K1', 'SHU'], {'8': 1, '2b': 0, '2': -1}),
    'R7F':  (['CEN', 'F1', 'F2', 'F3', 'VOK'], {'7': 0}),
}
ROUTES = {
    '1':  ['T', 'CS', 'CHC', 'CC2', 'R1'],
    '2':  ['T', 'PK', 'P2'],
    '2b': ['P2', 'PK', 'T', 'RG'],
    '3':  ['T', 'PK', 'R3A', 'R3B', 'R3L', 'R3E', 'R3E', 'R3U'],
    '4':  ['T', 'SV', 'DPC', 'R4', 'R4L', 'R4B'],
    '5':  ['T', 'CS', 'CHC', 'CC2', 'R5'],
    '6':  ['W6', 'T', 'SV', 'DPC', 'R6E'],
    '7':  ['T', 'CS', 'CHC', 'CHM', 'MS'],
    '8':  ['MS', 'RG', 'T', 'SV', 'B8'],
}
# пунктир — рейси іншим шляхом (варіанти шляху в датасеті)
DASHED = {
    '2': [['RG']],              # через вокзал до Шухевича
    '4': [['R4H']],             # Грозине
    '6': [['R6S']],             # по Південній
    '7': [['R7F']],             # через Франка
    '8': [['R8S'], ['R8U']],    # Сади, Дачі УТОС
}

HUBS = [
    dict(key='VOK', stop='st_1001', name='Залізничний вокзал', sub='', r=48, lx=600, ly=352, anchor='end',
         term=['1', '2', '3', '4', '5', '7'], bx=600, by=360, balign='end'),
    dict(key='RYN', stop='st_1002', name='Міський ринок', sub='', r=48, lx=708, ly=616, anchor='end', term=[], bx=0, by=0, balign='end'),
    dict(key='CEN', stop='st_1003', name='Центр міста', sub='', r=24, lx=726, ly=690, anchor='end', term=[], bx=0, by=0, balign='end'),
    dict(key='PARK', stop='st_1016', name='Парк «Древлянський»', sub='', r=24, lx=972, ly=580, anchor='start', term=[], bx=0, by=0, balign='start'),
    dict(key='SHV', stop='st_1037', name='Швейна фабрика', sub='', r=22, lx=906, ly=652, anchor='start', term=[], bx=0, by=0, balign='end'),
    dict(key='CHE', stop='st_1006', name='Черемушки', sub='', r=22, lx=670, ly=838, anchor='start', term=[], bx=0, by=0, balign='start'),
    dict(key='SHU', stop='st_1069', name='Романа Шухевича', sub='Гастелло', r=22, lx=406, ly=796, anchor='end',
         term=['2b', '7'], bx=406, by=820, balign='end'),
]
TERMS = [
    dict(key='POL', stop='st_1015', name='Поліське водосховище', sub='', lx=380, ly=1036, anchor='end', routes=['1'], bx=380, by=1044, balign='end', end_of='1'),
    dict(key='BK', stop='st_1048', name='Білокоровицьке шосе', sub='', lx=270, ly=936, anchor='middle', routes=['5'], bx=270, by=944, balign='middle', end_of='5'),
    dict(key='PASH', stop='st_1087', name='Пашини', sub='', lx=972, ly=214, anchor='start', routes=['2', '2b'], bx=972, by=222, balign='start'),
    dict(key='PROL', stop='st_1036', name='Вул. Проліскова', sub='', lx=140, ly=180, anchor='middle', routes=['3'], bx=140, by=216, balign='middle'),
    dict(key='KYIV', stop='st_1044', name='Вул. Київська', sub='', lx=1284, ly=766, anchor='start', routes=['4'], bx=1284, by=774, balign='start'),
    dict(key='ZH', stop='st_1049', name='Станція Житомирська', sub='', lx=220, ly=576, anchor='middle', routes=['6'], bx=220, by=584, balign='middle', end_of='6'),
    dict(key='CEG', stop='st_1061', name='Цегельний завод', sub='', lx=1120, ly=1036, anchor='middle', routes=['6'], bx=1120, by=1044, balign='middle'),
    dict(key='BRO', stop='st_1076', name='Бровар', sub='', lx=860, ly=904, anchor='end', routes=['8'], bx=860, by=912, balign='end', end_of='8'),
    dict(key='MAG', stop='st_1068', name='Магазин №44', sub='', lx=540, ly=776, anchor='middle', routes=['8'], bx=0, by=0, balign='middle', badges=False),
    # кінцеві окремих рейсів (пунктир)
    dict(key='HROZ', stop='st_1101', name='Грозине', sub='окремі рейси', lx=1284, ly=866, anchor='start', routes=['4'], bx=1284, by=890, balign='start'),
    dict(key='SADY', stop='st_1105', name='Сади', sub='сезонно', lx=820, ly=992, anchor='middle', routes=['8'], bx=820, by=1010, balign='middle'),
    dict(key='UTOS', stop='st_1102', name='Дачі УТОС', sub='окремі рейси', lx=950, ly=992, anchor='middle', routes=['8'], bx=950, by=1010, balign='middle'),
]

WAYPOINTS = [
    dict(cor='PK',  seg=0, t=0.5, stop='st_1104', name='Міськвиконком', lx=850, ly=572, anchor='start'),
    dict(cor='P2',  seg=0, t=0.18, stop='st_1079', name='Міськлікарня', lx=962, ly=490, anchor='start'),
    dict(cor='P2',  seg=0, t=0.42, stop='st_1082', name='Граніт', lx=962, ly=414, anchor='start'),
    dict(cor='P2',  seg=0, t=0.6, stop='st_1083', name='ДУ', lx=962, ly=356, anchor='start'),
    dict(cor='P2',  seg=0, t=0.8, stop='st_1085', name='Районна поліклініка', lx=962, ly=292, anchor='start'),
    dict(cor='R3A', seg=1, t=0.6, stop='st_1020', name='Хіммаш', lx=874, ly=380, anchor='start'),
    dict(cor='R3A', seg=2, t=0.1, stop='st_1021', name='Гастроном', lx=830, ly=306, anchor='middle'),
    dict(cor='R3A', seg=2, t=0.42, stop='st_1023', name='Прорізна, 33', lx=729, ly=306, anchor='middle'),
    dict(cor='R3A', seg=2, t=0.75, stop='st_1025', name='Фабрика «Ельфа»', lx=610, ly=306, anchor='middle'),
    dict(cor='R3A', seg=3, t=0.5, stop='st_1027', name='Вул. Стельмаха', lx=508, ly=290, anchor='start'),
    dict(cor='R3B', seg=0, t=0.0, stop='st_1031', name='Коростень-Подільський', lx=480, ly=190, anchor='start'),
    dict(cor='R3L', seg=1, t=0.5, stop='st_1033', name='Церква', lx=300, ly=264, anchor='middle'),
    dict(cor='R3E', seg=0, t=0.0, stop='st_1035', name='Чигирі', lx=220, ly=186, anchor='middle'),
    dict(cor='CHC', seg=0, t=0.5, stop='st_1005', name='В. Стуса', lx=722, ly=764, anchor='start'),
    dict(cor='CC2', seg=0, t=0.45, stop='st_1007', name='Ветлікарня', lx=612, ly=858, anchor='start'),
    dict(cor='CC2', seg=0, t=1.0, stop='st_1010', name='Чолівський переїзд', lx=526, ly=882, anchor='end'),
    dict(cor='R1',  seg=0, t=0.35, stop='st_1011', name='Школа №13', lx=478, ly=956, anchor='end'),
    dict(cor='R1',  seg=0, t=0.7, stop='st_1013', name='Селище Мирне', lx=430, ly=1004, anchor='end'),
    dict(cor='R5',  seg=0, t=0.5, stop='st_1047', name='КВК №71', lx=410, ly=926, anchor='middle'),
    dict(cor='RG',  seg=0, t=0.4, stop='st_1064', name='Школа №1', lx=540, ly=496, anchor='end'),
    dict(cor='RG',  seg=1, t=0.3, stop='st_1073', name='Районна лікарня', lx=412, ly=678, anchor='end'),
    dict(cor='W6',  seg=1, t=0.22, stop='st_1053', name='Шевченка, 117', lx=406, ly=446, anchor='middle'),
    dict(cor='W6',  seg=1, t=0.58, stop='st_1055', name='Стадіон «Локомотив»', lx=514, ly=446, anchor='middle'),
    dict(cor='W6',  seg=0, t=0.5, stop='st_1051', name='Завод ЗБШ', lx=266, ly=470, anchor='end'),
    dict(cor='B8',  seg=0, t=0.5, stop='st_1074', name='Вул. 1-го Травня', lx=868, ly=784, anchor='end'),
    dict(cor='DPC', seg=0, t=1.0, stop='st_1038', name='Дім правосуддя', lx=1004, ly=766, anchor='start'),
    dict(cor='R4',  seg=1, t=1.0, stop='st_1041', name='Трубосталь', lx=1172, ly=646, anchor='start'),
    dict(cor='R4L', seg=1, t=0.5, stop='st_1043', name='Діагностичний центр', lx=1272, ly=714, anchor='start'),
    dict(cor='R6E', seg=0, t=1.0, stop='st_1057', name='Аптека', lx=1082, ly=836, anchor='start'),
    dict(cor='R6E', seg=1, t=0.5, stop='st_1063', name='ПМК', lx=1144, ly=954, anchor='start'),
    dict(cor='R6S', seg=0, t=0.55, stop='st_1060', name='Вул. Південна', lx=1044, ly=900, anchor='end'),
    dict(cor='R7F', seg=0, t=0.65, stop='st_1071', name='Вул. І. Франка', lx=802, ly=718, anchor='middle'),
    dict(cor='R7F', seg=2, t=0.45, stop='st_1072', name='СМП 650', lx=745, ly=378, anchor='middle'),
]
NODE_STOPS = {}

# вода: Поліське водосховище біля кінцевої №1, річка Уж — від нього на північний схід через місто
RESERVOIR = [(300, 1070), (380, 1058), (450, 1064), (500, 1086), (452, 1108), (360, 1112), (306, 1096)]
RIVER = [(470, 1070), (720, 820), (1060, 820), (1100, 780), (1100, 540), (1390, 540)]
WATER_LABELS = [dict(text='р. Уж', x=1270, y=530, anchor='middle'),
                dict(text='р. Уж', x=600, y=944, anchor='middle')]

# ---------------------------------------------------------------- сторінка в Docs і заголовки файлів сайту
HTML_TMPL = HTML_TMPL.replace('<title>Схема маршрутів Малина</title>', '<title>Схема маршрутів Коростеня</title>')
HTML_TMPL = re.sub(r'<section>\s*<h2>Як читати</h2>.*</section>', '''<section>
      <h2>Як читати</h2>
      <ul>
        <li>Великі кільця — вузли, де сходяться кілька маршрутів: вокзал і ринок (пучок усіх ліній між ними), Центр, Парк «Древлянський», Швейна фабрика, Черемушки, Шухевича.</li>
        <li>Номери в кольорових плашках біля зупинки — маршрути, для яких ця зупинка кінцева.</li>
        <li>Пунктир — окремі рейси іншим шляхом: №2 через вокзал до Шухевича, №4 до Грозиного, №6 по Південній, №7 через Франка, №8 до Садів і Дач УТОС.</li>
        <li>Дрібні сірі підписи — деякі проміжні зупинки, не повний перелік. Схема не в масштабі.</li>
      </ul>
    </section>
    <section>
      <h2>Звідки дані</h2>
      <ul>
        <li>Склад маршрутів і рейси — розклад руху Коростенської міської ради (листопад 2026); порядок зупинок — проєкт власника сайту 2025 року.</li>
        <li>Вигляд і кольори — авторська схема власника сайту 2019 року; лінії 6А, 6Б, 7А, 12, 14 зі схеми 2019 прибрано — у розкладі їх нема.</li>
        <li>Кількість рейсів і час першого/останнього — з бази сайту (/transport/dataset?city=Korosten).</li>
      </ul>
    </section>''', HTML_TMPL, count=1, flags=re.S)
SITE_ROUTES_TS_HEAD = SITE_ROUTES_TS_HEAD.replace(
    'build_scheme.py --site-dir', 'build_scheme.py --city Docs/korosten-transit-scheme/korosten_scheme.py --site-dir')
SITE_NODES_TS_HEAD = SITE_NODES_TS_HEAD.replace(
    'build_scheme.py --site-dir', 'build_scheme.py --city Docs/korosten-transit-scheme/korosten_scheme.py --site-dir')
