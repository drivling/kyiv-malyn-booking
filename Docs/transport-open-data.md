# Відкриті дані транспорту Малина

Розклад міських маршруток Малина, який показує [malin.kiev.ua/transport](https://malin.kiev.ua/transport), можна
забрати з собою у відкритому форматі та відкрити в будь-якому іншому застосунку. Це сторінка для людей —
розробників, дослідників, студентів, журналістів. Технічні рішення (кеш, версії, ліцензія) —
[`transport-open-data-2026-10.md`](transport-open-data-2026-10.md); як влаштований фід —
[`local-transport-gtfs-feed.md`](local-transport-gtfs-feed.md).

## Що можна завантажити

| Файл | Адреса | Що всередині |
|---|---|---|
| **GTFS** (zip) | `https://malin.kiev.ua/transport/gtfs.zip` (302 на бекенд — адреса стала, домен бекенду ні; `curl -L`) | зупинки з координатами, маршрути, рейси з часом на кожній зупинці, лінії маршрутів — стандарт, який читають Google Maps, OpenTripPlanner, Transitous, QGIS, десятки бібліотек |
| один файл фіду | `https://malin.kiev.ua/transport/gtfs/feed_info.txt`, `…/transport/gtfs/stops.txt` тощо (теж 302) | той самий GTFS по одному файлу — зручно для `curl` і щоб перевірити версію без zip |
| **JSON** сайту | `https://malin.kiev.ua/transport/dataset.json` | повний датасет у внутрішньому форматі сайту (`stops`, `routes`, `routeStops`, `trips`, `segments`, `meta`, `revision`) — знімок на момент збірки сайту |
| JSON наживо | `https://kyiv-malyn-booking-production.up.railway.app/transport/dataset` | те саме, прямо з бази, завжди поточне |
| зупинка за id | `…/transport/stops/st_0019`, мапа злитих — `…/transport/stop-redirects` | назва, координати, маршрути; старий id → 301 на чинний («Що ми обіцяємо») |
| **RSS** змін розкладу | `https://malin.kiev.ua/transport/changes.rss` | запис на кожну нову версію даних (дата, скільки маршрутів/рейсів/зупинок, посилання на GTFS); підпишіться — і побачите, коли мінявся розклад |
| **iCal** маршруту | `https://malin.kiev.ua/transport/route/<id>/calendar.ics` | подія на кожен рейс із тижневим повтором, час Europe/Kyiv; додавайте **за адресою** (Google Calendar «за URL», Apple «Підписка»), не файлом — тоді оновлюється разом із розкладом |
| **OpenAPI 3.1** | `https://malin.kiev.ua/openapi.yaml` | машинний опис усіх публічних ендпоінтів |

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
| `attributions.txt` | виробник фіду (стандартний файл атрибуції GTFS): malin.kiev.ua, посилання, email |
| `LICENSE.txt` | ліцензія й атрибуція (не частина специфікації — валідатор каже `unknown_file`, це нормально) |

У фіді **лише** маршрути з підтвердженим розкладом. Маршрути, де відомі тільки номери машин без часу, а також
маршрути, позначені на сайті як ненадійні, у фід не потрапляють (на сайті їх теж не показуємо). Час між
зупинками, де немає офіційного листка, розрахований — тому `timepoint=0`.

Ідентифікатори стабільні: `stop_id` і `route_id` ті самі, що в адресах сайту (`/transport/stop/st_0019`,
`/transport/route/11`) — розділ «Що ми обіцяємо» нижче.

## Що ми обіцяємо

Контракт для застосунків, які будуються на цих даних (етап 4, [`transport-open-protocols-2026-10.md`](transport-open-protocols-2026-10.md)):

| що | обіцянка |
|---|---|
| `stop_id` (`st_NNNN`) | не змінюється й **не перевикористовується**; перейменування зупинки id не змінює |
| `route_id` («11») | не змінюється; номер, який бачать люди («11/1»), — окреме поле `shortName` / `route_short_name` |
| злита або видалена зупинка | старий id лишається в мапі `meta.stopRedirects` датасету щонайменше рік; `GET /transport/stops/<старий>` відповідає 301 на чинний, `/transport/stop/<старий>` на сайті веде на чинне табло |
| `revision` | ISO-час останньої зміни, монотонний; той самий у `GET /transport/dataset`, `feed_info.feed_version` і `ETag` |
| `trip_id` | стабільний лише в межах однієї `revision` (рейси перенумеровуються при зміні розкладу) |
| адреси | `https://malin.kiev.ua/transport/gtfs.zip`, `/transport/gtfs/<file>.txt`, `/transport/dataset.json`, `/openapi.yaml` на домені сайту не змінюються (відповідають 302 на поточний бекенд) |
| формат | GTFS Static за специфікацією; JSON датасету — внутрішній, поля можуть додаватись, наявні не зникають без згадки тут |

Як це перевірити:

```bash
curl -s https://kyiv-malyn-booking-production.up.railway.app/transport/stops/st_0019      # чинна зупинка → JSON з маршрутами
curl -sI https://kyiv-malyn-booking-production.up.railway.app/transport/stops/st_0042     # злита → 301 Location: /transport/stops/<new>
curl -s https://kyiv-malyn-booking-production.up.railway.app/transport/stop-redirects     # уся мапа { "старий": "чинний" }
```

Машинний опис усіх публічних ендпоінтів — OpenAPI 3.1: `https://malin.kiev.ua/openapi.yaml`
(сторінка для розробників — [malin.kiev.ua/support/api](https://malin.kiev.ua/support/api)).

Для адміністратора: злиття зупинки = видалити її в редакторі карти (її рейси перенести на чинну) і записати редирект
окремим запитом — PUT датасету мапу не чіпає, а скриптовий PUT без ключа `stopRedirects` у `meta` її зітре:

```bash
TOKEN=$(curl -s -X POST https://kyiv-malyn-booking-production.up.railway.app/admin/login -H 'content-type: application/json' -d '{"password":"…"}' | jq -r .token)
curl -s -X PUT https://kyiv-malyn-booking-production.up.railway.app/admin/transport/stop-redirects \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"redirects":{"st_0042":"st_0019"}}'        # мапа замінюється цілком; жива зупинка ключем або невідома ціль → 400
```

## Версії й оновлення

- `feed_version` у `feed_info.txt` — це `revision` датасету: момент останньої зміни в адмінці
  (`2026-10-14T18:03:11.000Z`). Та сама `revision` є в `dataset.json` і підписана на сайті («станом на 14.10.2026»).
- Сервер віддає `ETag: "<revision>"` і `Last-Modified`. Щоб дізнатися, чи змінився розклад, не завантажуючи zip:

  ```bash
  curl -sIL https://malin.kiev.ua/transport/gtfs.zip | grep -i etag
  ```

  або умовний запит з `If-None-Match` — відповідь `304`, якщо нічого не змінилось.
- Кеш — 5 хвилин (`Cache-Control: public, max-age=300`): після правки в адмінці новий фід з'являється за ≤ 5 хв.
- Зміни в розкладі трапляються кілька разів на місяць. Для застосунків достатньо перевіряти раз на добу.

## Як відкрити

**Швидко подивитися** — розпакуйте zip і відкрийте `stops.txt` чи `stop_times.txt` у LibreOffice / Google Sheets
(кодування UTF-8, роздільник — кома).

**Перевірити фід** офіційним валідатором MobilityData (jar потребує Java 17; без Java — Docker):

```bash
curl -sLo malyn-gtfs.zip https://malin.kiev.ua/transport/gtfs.zip
curl -sLo gtfs-validator.jar https://github.com/MobilityData/gtfs-validator/releases/download/v8.0.1/gtfs-validator-8.0.1-cli.jar
java -jar gtfs-validator.jar -i malyn-gtfs.zip -o report -c ua
# або: docker run --rm -v "$PWD:/work" ghcr.io/mobilitydata/gtfs-validator:latest -i /work/malyn-gtfs.zip -o /work/report -c ua
```

Звіт — `report/report.html` і `report/report.json`. Стан на 2026-10-18 (валідатор 8.0.1): **0 помилок**; попередження
`mixed_case_recommended_field` на справжніх абревіатурах («14 ОМБ», «10 ОГШБ», «ЗОШ»); info `trip_headsign_matches_intermediate_stop`
на кількох рейсах і `unknown_file` для `LICENSE.txt`.

**Побудувати маршрути в OpenTripPlanner** (планувальник з пересадками, пішохідні ділянки — потрібна ще мапа
OSM Малина, наприклад витяг із [Geofabrik](https://download.geofabrik.de/europe/ukraine.html) або
[extract.bbbike.org](https://extract.bbbike.org/)):

```bash
mkdir otp && cd otp
curl -sLo malyn-gtfs.zip https://malin.kiev.ua/transport/gtfs.zip
# покласти поруч malyn.osm.pbf
curl -sLo otp.jar https://repo1.maven.org/maven2/org/opentripplanner/otp/2.5.0/otp-2.5.0-shaded.jar
java -Xmx2G -jar otp.jar --build --serve .
# http://localhost:8080
```

**Python** — [`gtfs-kit`](https://github.com/mrcagney/gtfs_kit) або просто `pandas`:

```python
import pandas as pd, zipfile, io, requests
z = zipfile.ZipFile(io.BytesIO(requests.get("https://malin.kiev.ua/transport/gtfs.zip").content))
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

> Дані: malin.kiev.ua — Сергій Меренков / ТОВ «Технології» (technologies.llc)

Самі факти (що автобус №5 відправляється о 7:10) нікому не належать — ліцензія стосується зібраної бази, а не фактів
і не офіційних рішень міськради, які лишаються першоджерелом.

Помилку в даних, нову зупинку чи змінений графік повідомляйте через [сторінку контактів](https://malin.kiev.ua/support/contact)
або `mer.sergei@gmail.com` (контакт у `feed_info.txt`).

## Чого поки нема

- Журналу «що саме змінилось» між версіями: RSS каже лише **коли** й скільки чого у фіді, бо сервер не зберігає
  попередні версії датасету (потрібна таблиця ревізій — план у `transport-open-protocols-2026-10.md`, «Що далі»).

- GTFS-Realtime (де автобус зараз) — даних про рух нема; є лише відмітки пасажирів «Факт прибуття» на сайті.
- Фід у каталогах Mobility Database / Transitland: файли для реєстрації готові
  ([`open-protocols/README.md`](open-protocols/README.md)), подає власник; поки не зареєстровано.
- Міжміських рейсів (Малин ↔ Київ, Житомир, Коростень) у GTFS — лише міський транспорт.
