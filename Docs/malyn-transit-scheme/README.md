# Схема міських маршрутів Малина (стиль метро)

Октолінійна схема 9 міських маршрутів (2, 3, 5, 7, 8, 9, 10, 11, 12): кінцеві, центральні та вузлові
зупинки, річка Ірша з водосховищем (схематично, контури за OpenStreetMap), легенда з «через»,
кількістю рейсів і часом першого/останнього. Не в масштабі.

Маршрут 10 намальований за старою схемою на вокзалі (петля Лікарня → Автостанція / Укр. Повстанців
→ Центр → Грушевського → Вокзал); поки його розклад у базі не заповнений, у легенді стоїть
«розклад уточнюється» (`UNCONFIRMED` у генераторі). Після заповнення — прибрати `'10'` з `UNCONFIRMED`.

- `malyn-transit-scheme.svg` — самодостатній файл (світла тема) для друку, месенджерів, соцмереж.
- `index.html` — та сама схема як сторінка зі світлою/темною темою й примітками.
- `build_scheme.py` — генератор. Геометрія (вузли, коридори, смуги) задана вручну в коді;
  легенда рахується з `/transport/dataset` (кількість рейсів у кожен бік, перший–останній).

На сайті схема живе на `/transport/scheme` (вкладка «Схема» розділу транспорту,
`frontend/src/pages/LocalTransportPage/LocalTransportSchemePage.tsx`). Сторінка вставляє
згенерований `scheme/malyn-scheme.svg` (лінії з `data-route`, зупинки з `data-stop`) і бере
легенду зі згенерованого `scheme/malyn-scheme-routes.ts`; статистика рейсів рахується з датасету
на льоту. Плакат із QR-кодом лежить у `frontend/public/transport/scheme/` і віддається як статика.

Той самий SVG повторно використовують:
- `LocalTransportSchemeMini.tsx` — міні-схема на сторінках маршруту (`/transport/route/:id`,
  яскрава лише ця лінія) і зупинки (`/transport/stop/:id`, лінії через зупинку + маркер «ви тут»,
  якщо зупинка є вузлом/орієнтиром схеми). Кадр обрізається до підсвічених ліній і їхніх зупинок
  (`getBBox`, лише в браузері), уся мініатюра — посилання на `/transport/scheme?route=` /
  `?stop=`. Стани SVG (притьмарення, «ви тут») — у `scheme/scheme-svg.css`.
- `routeColors.ts` — кольори ліній (`--lt-route-color`, `--lts-r<id>`) для плашок номерів.
- `schemeStops.ts` (`routesAtStop`) — лінії схеми через зупинку з `routeStops` датасету (без
  `mapOnly` і ненадійних). Увага: вузол схеми — один `data-stop`, тож «Лікарня · Поліклініка»
  підсвічує лише лінії зупинки `st_0035`, а не всіх фізичних зупинок вузла.

Сторінка схеми розуміє `?route=<id>` (обрана лінія) і `?stop=<id>` (маркер «ви тут», лінії через
зупинку, прокрутка полотна до неї, картка з посиланням на табло).

Перегенерувати після зміни розкладів або геометрії (з кореня репозиторію):

```bash
pip install segno                                  # QR-код для плаката (один раз)
cd Docs/malyn-transit-scheme
python3 build_scheme.py --out-dir . \
  --site-dir ../../frontend/src/pages/LocalTransportPage/scheme \
  --poster-dir ../../frontend/public/transport/scheme \
  --qr-url https://malin.kiev.ua/transport/scheme \
  --fonts-dir fonts                                # woff2 Golos Text (кирилиця + латиниця) для плаката; без нього — системний шрифт
# --dataset dataset.json — замість Railway API взяти локальний JSON (GET /transport/dataset)
```

PDF плаката (A2 landscape 594×420 мм, той самий SVG; правило `@page` вже вшите у стиль SVG)
робиться Chromium-ом прямо з файла:

```bash
cd frontend/public/transport/scheme
chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=malyn-transit-scheme-poster.pdf "file://$PWD/malyn-transit-scheme-poster.svg"
```

Шрифт у PDF береться з вбудованого в SVG woff2 (або з системного Golos Text, якщо встановлений).
QR-код можна перевірити, наприклад, `cv2.QRCodeDetector().detectAndDecode()` на PNG-рендері.

Перелік маршрутів на схемі — `ROUTE_ORDER` у генераторі (оновлюється вручну); маршрут 1 і
`10-old` на схему не потрапляють.
