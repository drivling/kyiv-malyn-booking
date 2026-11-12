# Схема міських маршрутів Коростеня (стиль метро)

Октолінійна схема 9 ліній розкладу Коростенської міської ради (1, 2, 2-Б, 3, 4, 5, 6, 7, 8): пучок вокзал → ринок, три
віяла від ринку (Парк «Древлянський», Швейна фабрика, Центр), кільце через Шухевича, рейси іншим шляхом — пунктиром
кольору своєї лінії (№2 через вокзал до Шухевича, №4 до Грозиного, №6 по Південній, №7 через Франка, №8 до Садів і Дач
УТОС). Вигляд і кольори — авторська схема власника 2019 року (`data/korosten-transport/scheme-2019/`); лінії 2019 року
6А, 6Б, 7А, 12, 14 прибрано. Під-план — [`Docs/korosten-scheme-2026-11.md`](../korosten-scheme-2026-11.md).

- `korosten_scheme.py` — **лише геометрія й тексти**: вузли `N`, коридори зі смугами `C`, маршрути `ROUTES`, пунктир
  `DASHED`, вузли / кінцеві / орієнтири, легенда, вода, кольори. Генератор спільний з Малином —
  `Docs/malyn-transit-scheme/build_scheme.py` (`--city` виконує цей файл у своєму просторі імен).
- `index.html`, `korosten-transit-scheme.svg` — сторінка й SVG для друку / месенджерів.
- На сайті: `frontend/src/pages/LocalTransportPage/scheme/korosten-scheme.svg`, `korosten-scheme-routes.ts`,
  `korosten-scheme-nodes.ts` (реєстр схем — `scheme/registry.ts`); плакат із QR на korosten.kiev.ua/transport/scheme —
  `frontend/public/transport/scheme/korosten-transit-scheme-poster.{svg,pdf}`.

2-Б — окремий маршрут у тому ж фіолетовому пучку, що 2 і 3, тому лінія з білою смугою посередині (`STRIPED`); кольори
ліній ті самі, що в `meta.routeColors` датасету Коростеня. Номер на плашці — білий або чорний за контрастом (як у Малина).

## Перегенерувати

Датасет Коростеня, поки прапорець транспорту вимкнено, віддається лише адміну: `ADMIN_TOKEN` (або `VIBER_ADMIN_TOKEN`)
у середовищі, або `--dataset` з файлом `GET /transport/dataset?city=Korosten`.

```bash
cd Docs/malyn-transit-scheme
python3 build_scheme.py --city ../korosten-transit-scheme/korosten_scheme.py --out-dir ../korosten-transit-scheme \
  --site-dir ../../frontend/src/pages/LocalTransportPage/scheme \
  --poster-dir ../../frontend/public/transport/scheme \
  --fonts-dir fonts            # woff2 Golos Text; або --reuse-poster (QR і шрифти з наявного плаката)
```

PDF плаката — той самий SVG, надрукований браузером (A2 landscape, правило `@page` у стилі SVG), напр. Chromium
`--print-to-pdf` або Playwright `page.pdf({ preferCSSPageSize: true })`.

Перевірити на око: відкрити `korosten-transit-scheme.svg` (або PNG-рендер) — підписи не налазять на лінії, кінцеві з
плашками номерів. Після зміни складу маршрутів (новий номер, інший шлях) правити `ROUTES`, `C` і `LEGEND` тут, а не SVG.
