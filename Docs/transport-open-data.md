# Відкриті дані транспорту Малина

Розклад міських маршруток Малина, який показує [malin.kiev.ua/transport](https://malin.kiev.ua/transport), можна
забрати з собою у відкритому форматі та відкрити в будь-якому іншому застосунку. Це сторінка для людей —
розробників, дослідників, студентів, журналістів. Технічні рішення (кеш, версії, ліцензія) —
[`transport-open-data-2026-10.md`](transport-open-data-2026-10.md); як влаштований фід —
[`local-transport-gtfs-feed.md`](local-transport-gtfs-feed.md).

## Що можна завантажити

| Файл | Адреса | Що всередині |
|---|---|---|
| **GTFS** (zip) | `https://kyiv-malyn-booking-production.up.railway.app/transport/gtfs.zip` | зупинки з координатами, маршрути, рейси з часом на кожній зупинці, лінії маршрутів — стандарт, який читають Google Maps, OpenTripPlanner, Transitous, QGIS, десятки бібліотек |
| один файл фіду | `…/transport/gtfs/feed_info.txt`, `…/transport/gtfs/stops.txt` тощо | той самий GTFS по одному файлу — зручно для `curl` і щоб перевірити версію без zip |
| **JSON** сайту | `https://malin.kiev.ua/transport/dataset.json` | повний датасет у внутрішньому форматі сайту (`stops`, `routes`, `routeStops`, `trips`, `segments`, `meta`, `revision`) — знімок на момент збірки сайту |
| JSON наживо | `https://kyiv-malyn-booking-production.up.railway.app/transport/dataset` | те саме, прямо з бази, завжди поточне |

Кнопки для цих файлів є внизу сторінки [схеми маршрутів](https://malin.kiev.ua/transport/scheme#open-data).

## Що саме в GTFS

Папка з текстовими таблицями (CSV, UTF-8), як вимагає [специфікація GTFS Static](https://gtfs.org/schedule/reference/):

| Файл | Зміст |
|---|---|
| `agency.txt` | перевізник: «Громадський транспорт міста Малина», часовий пояс `Europe/Kyiv` |
| `stops.txt` | зупинки: `stop_id` (`st_0019`), назва, широта/довгота |
| `routes.txt` | маршрути: `route_id` — внутрішній номер («11»), `route_short_name` — номер, який бачать люди («11/1», «5А»), `route_long_name` — кінцеві |
| `trips.txt` | рейси: маршрут, напрямок (`direction_id` 1 — «туди», 0 — «назад»), календар, `shape_id` |
| `stop_times.txt` | час на кожній зупинці кожного рейсу; `timepoint=1` — час із офіційного листка, `0` — розрахований за тривалістю перегонів |
| `calendar.txt` | два календарі: `everyday` (щодня) і `weekdays` (пн–пт) |
| `shapes.txt` | ламані ліній маршрутів (між зупинками, з технічними точками на поворотах) |
| `feed_info.txt` | видавець, контакт, **`feed_version`** — версія даних |
| `LICENSE.txt` | ліцензія й атрибуція |

У фіді **лише** маршрути з підтвердженим розкладом. Маршрути, де відомі тільки номери машин без часу, а також
маршрути, позначені на сайті як ненадійні, у фід не потрапляють (на сайті їх теж не показуємо). Час між
зупинками, де немає офіційного листка, розрахований — тому `timepoint=0`.

Ідентифікатори стабільні: `stop_id` і `route_id` ті самі, що в адресах сайту (`/transport/stop/st_0019`,
`/transport/route/11`), і не змінюються між версіями без окремого рішення.

## Версії й оновлення

- `feed_version` у `feed_info.txt` — це `revision` датасету: момент останньої зміни в адмінці
  (`2026-10-14T18:03:11.000Z`). Та сама `revision` є в `dataset.json` і підписана на сайті («станом на 14.10.2026»).
- Сервер віддає `ETag: "<revision>"` і `Last-Modified`. Щоб дізнатися, чи змінився розклад, не завантажуючи zip:

  ```bash
  curl -sI https://kyiv-malyn-booking-production.up.railway.app/transport/gtfs.zip | grep -i etag
  ```

  або умовний запит з `If-None-Match` — відповідь `304`, якщо нічого не змінилось.
- Кеш — 5 хвилин (`Cache-Control: public, max-age=300`): після правки в адмінці новий фід з'являється за ≤ 5 хв.
- Зміни в розкладі трапляються кілька разів на місяць. Для застосунків достатньо перевіряти раз на добу.

## Як відкрити

**Швидко подивитися** — розпакуйте zip і відкрийте `stops.txt` чи `stop_times.txt` у LibreOffice / Google Sheets
(кодування UTF-8, роздільник — кома).

**Перевірити фід** офіційним валідатором MobilityData:

```bash
curl -sLo malyn-gtfs.zip https://kyiv-malyn-booking-production.up.railway.app/transport/gtfs.zip
docker run --rm -v "$PWD:/work" ghcr.io/mobilitydata/gtfs-validator:latest -i /work/malyn-gtfs.zip -o /work/report
```

Звіт — `report/report.html`. Відомі зауваження: `mixed_case_recommended_field` на скорочених назвах («ЗОШ», «ОМБ»).

**Побудувати маршрути в OpenTripPlanner** (планувальник з пересадками, пішохідні ділянки — потрібна ще мапа
OSM Малина, наприклад витяг із [Geofabrik](https://download.geofabrik.de/europe/ukraine.html) або
[extract.bbbike.org](https://extract.bbbike.org/)):

```bash
mkdir otp && cd otp
curl -sLo malyn-gtfs.zip https://kyiv-malyn-booking-production.up.railway.app/transport/gtfs.zip
# покласти поруч malyn.osm.pbf
curl -sLo otp.jar https://repo1.maven.org/maven2/org/opentripplanner/otp/2.5.0/otp-2.5.0-shaded.jar
java -Xmx2G -jar otp.jar --build --serve .
# http://localhost:8080
```

**Python** — [`gtfs-kit`](https://github.com/mrcagney/gtfs_kit) або просто `pandas`:

```python
import pandas as pd, zipfile, io, requests
z = zipfile.ZipFile(io.BytesIO(requests.get("https://kyiv-malyn-booking-production.up.railway.app/transport/gtfs.zip").content))
stops = pd.read_csv(z.open("stops.txt"))
stop_times = pd.read_csv(z.open("stop_times.txt"))
print(stop_times.merge(stops, on="stop_id").query("stop_name == 'Залізничний вокзал'").sort_values("departure_time").head())
```

**QGIS** — плагін «GTFS Loader» або імпорт `stops.txt` як CSV з координатами і `shapes.txt` як лінії.

**JSON сайту** (`dataset.json`) — той формат, яким живе сам сайт: там є те, чого нема в GTFS (сегменти з
тривалістю перегонів, варіанти шляху, опорні часи, тариф і контакти в `meta`). Структура описана в
`backend/src/local-transport.ts` (`TransportDataset`). Формат внутрішній і може змінюватись разом із сайтом —
для сторонніх застосунків надійніший GTFS.

## Ліцензія та атрибуція

База даних (розклад, зупинки, лінії, координати) — це ручна праця команди malin.kiev.ua: знайдено, структуровано,
перевірено на місцях. Вона опублікована за **[OwnNet Source License 1.1](https://own-net.com/license.html)** — тією самою, що й код;
ліцензіар — Сергій Меренков / ТОВ «Технології» (код ЄДРПОУ 46288273). Коротко:

- **вільно** для людей, навчання, досліджень, міста та бізнесу з річним доходом до 100 000 USD: копіюйте, змінюйте,
  вбудовуйте у свої застосунки, вказавши джерело;
- **похідна база** (ваші виправлення, доповнення) публікується під цією ж ліцензією — share-alike;
- **за письмовим договором** із ліцензіаром: використання корпораціями понад поріг, платний SaaS чи перепродаж даних
  (`mer.sergei@gmail.com`);
- на цих даних **не можна** будувати закриті системи — з віддаленим вимкненням, без експорту, зі стеженням.

Атрибуція у застосунку, описі чи звіті:

> Дані: malin.kiev.ua — Сергій Меренков / ТОВ «Технології» (own-net.com)

Самі факти (що автобус №5 відправляється о 7:10) нікому не належать — ліцензія стосується зібраної бази, а не фактів
і не офіційних рішень міськради, які лишаються першоджерелом.

Помилку в даних, нову зупинку чи змінений графік повідомляйте через [сторінку контактів](https://malin.kiev.ua/support/contact)
або `mer.sergei@gmail.com` (контакт у `feed_info.txt`).

## Чого поки нема

- GTFS-Realtime (де автобус зараз) — даних про рух нема; є лише відмітки пасажирів «Факт прибуття» на сайті.
- Фіду в каталогах Mobility Database / Transitland і OpenAPI публічних ендпоінтів — етап 4 плану
  (`transport-pwa-2026-10.md`, таблиця етапів).
- Міжміських рейсів (Малин ↔ Київ, Житомир, Коростень) у GTFS — лише міський транспорт.
