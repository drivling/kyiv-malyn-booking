# Реєстрація GTFS-фіду Малина в каталогах — що робить власник

Файли в цій теці підготовлені в етапі 4 «Відкриті протоколи» ([`../transport-open-protocols-2026-10.md`](../transport-open-protocols-2026-10.md),
фаза 1). PR у чужі репозиторії та форми подає **власник** зі свого акаунта: це його підпис під ліцензією фіду
(OwnNet Source License 1.1, рішення етапу 3), і листування з каталогами йтиме на `mer.sergei@gmail.com`.

**Передумова:** фронтенд із цієї гілки задеплоєний — `https://malin.kiev.ua/transport/gtfs.zip` має відповідати
`302` на бекенд (перевірка: `curl -sIL https://malin.kiev.ua/transport/gtfs.zip | grep -i -E '^(HTTP|etag)'` →
`302`, потім `200` і `etag`). До деплою в обох файлах можна тимчасово підставити
`https://kyiv-malyn-booking-production.up.railway.app/transport/gtfs.zip`, але краще дочекатись: каталоги
перевіряють адресу щодня, і змінювати її потім — окремий PR.

## 1. Mobility Database (MobilityData)

**Статус:** злито 2026-10-19 — PR <https://github.com/MobilityData/mobility-database-catalogs/pull/1751>; мейнтейнери дали `mdb_source_id` **3615**, сторінка фіду — <https://mobilitydatabase.org/feeds/mdb-3615>.
На Apple Silicon перед `pip install -r requirements.txt` потрібні `brew install geos spatialindex`, а після —
`pip install 'rtree>=1.3'`; id інструмента перевірити на колізію (`grep -rl '"mdb_source_id": <id>' catalogs/sources`).

Файл: [`mobility-database/ua-malyn-malin-kiev-ua-gtfs.json`](mobility-database/ua-malyn-malin-kiev-ua-gtfs.json).
`mdb_source_id` у ньому навмисно немає — номер дає каталог.

**Шлях А — форма (без GitHub, рекомендовано як перший крок):** <https://mobilitydatabase.org/contribute>.
Поля беруться з JSON: provider, country `UA`, subdivision `Zhytomyr Oblast`, municipality `Malyn`,
direct download URL, authentication type `0`, license URL `https://own-net.com/license.html`, contact email,
`is_official = False` (ми не міськрада). У полі коментаря:

> Community-maintained GTFS Static feed for the city buses (marshrutky) of Malyn, Zhytomyr Oblast, Ukraine.
> The dataset was collected and verified on site by malin.kiev.ua; feed_version equals the dataset revision
> (ISO timestamp), ETag/Last-Modified are set, the feed is rebuilt automatically after every schedule change.
> License: OwnNet Source License 1.1 (source-available, attribution + share-alike; free under USD 100k revenue).
> Validator 8.0.1: 0 errors, 1 warning class (mixed_case_recommended_field on genuine abbreviations).

**Шлях Б — PR у `MobilityData/mobility-database-catalogs`** (якщо форма мовчить ≥ 2 тижні):

```bash
git clone https://github.com/<your-fork>/mobility-database-catalogs && cd mobility-database-catalogs
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python3 - <<'EOF'
from tools.operations import add_gtfs_schedule_source
add_gtfs_schedule_source(
    provider="Malyn city public transport (community feed by malin.kiev.ua)",
    country_code="UA",
    subdivision_name="Zhytomyr Oblast",
    municipality="Malyn",
    direct_download_url="https://malin.kiev.ua/transport/gtfs.zip",
    authentication_type=0,
    license_url="https://own-net.com/license.html",
    name="Malyn (Zhytomyr Oblast, Ukraine) city buses — malin.kiev.ua",
    feed_contact_email="mer.sergei@gmail.com",
    status="active",
)
EOF
pytest
git checkout -b feat/malyn-gtfs && git add catalogs && git commit -m "feat: Add Malyn (Ukraine) GTFS Source [SOURCES]" && git push -u origin HEAD
```

Заголовок PR **обов'язково** містить `[SOURCES]`; відкривати як draft, потім «Ready for review» і запросити
рев'ю когось із MobilityData. Тіло PR — той самий абзац, що й для форми. Інструмент сам створить файл виду
`catalogs/sources/gtfs/schedule/ua-zhytomyr-oblast-malyn-malyn-city-public-transport-gtfs-<id>.json` —
наш JSON у теці лише як еталон полів.

## 2. Transitland Atlas

**Статус:** подано 2026-10-19 — PR <https://github.com/transitland/transitland-atlas/pull/2260> (форк `drivling/transitland-atlas`, гілка `malyn-ukraine`); формат DMFR приведено до канонічного за підказкою бота, файл у цій теці вже такий.

Файл: [`transitland/malin.kiev.ua.dmfr.json`](transitland/malin.kiev.ua.dmfr.json) — DMFR 0.5.1, Onestop ID
фіду `f-u9hbc-malyn~city~transport` (geohash `u9hbc` — центр Малина), оператор `o-u9hbc-malyn~city~transport`,
`gtfs_agency_id = malyn` як в `agency.txt`.

```bash
git clone https://github.com/<your-fork>/transitland-atlas && cd transitland-atlas
cp <repo>/Docs/open-protocols/transitland/malin.kiev.ua.dmfr.json feeds/malin.kiev.ua.dmfr.json
git checkout -b malyn-ukraine && git add feeds/malin.kiev.ua.dmfr.json && git commit -m "Add Malyn (Ukraine) city buses GTFS feed" && git push -u origin HEAD
```

Текст PR:

> Adds the GTFS Static feed of the city buses of Malyn, Zhytomyr Oblast, Ukraine (community feed, maintained by
> malin.kiev.ua; schedule collected and verified on site). feed_version = dataset revision, ETag set, rebuilt
> automatically after every schedule change. License: OwnNet Source License 1.1 (not SPDX — URL and flags given;
> attribution required, share-alike, commercial use free under USD 100k revenue, above that by agreement).

CI репозиторію перевіряє схему DMFR; якщо лінтер попросить інший формат Onestop ID — міняти лише суфікс після
geohash. Після мерджу фід з'явиться на `https://www.transit.land/feeds/f-u9hbc-malyn~city~transport` за добу.

## 3. Transitous — уже є, PR не потрібен

Мейнтейнер Transitous (Jonah Brüchert) сам додав фід у `feeds/ua.json` 2026-10-18 (`ua: Add Malyn`, тип `http`,
`https://malin.kiev.ua/transport/gtfs.zip`, ліцензія own-net.com з атрибуцією). Перевірено 2026-10-19 через
`api.transitous.org/api/v1/plan`: зупинки Малина геокодуються (`ua-malyn_st_0019` «Залізничний вокзал»), планувальник
будує маршрути рейсами №3, №7, №8 перевізника «Громадський транспорт міста Малина» — тобто пасажир може перевірити
наші маршрути на <https://transitous.org> (і в KDE Itinerary). Якщо колись знадобиться перевести запис на
`"type": "mobility-database", "mdb-id": "mdb-3615"` — це один PR у `public-transport/transitous`, форк
`drivling/transitous` уже є.

## 3а. Атрибуція в планувальниках — щоб бачили нас, а не міськраду

Що показує Transitous (перевірено 2026-10-19) і звідки це береться:

| де | поле | значення до → після |
|---|---|---|
| кнопка під рейсом у деталях маршруту | `agency_name` → посилання `agency_url` | «Громадський транспорт міста Малина» → `malyn-rada.gov.ua` → **`https://malin.kiev.ua/transport`** |
| transitous.org/sources, «published by» | `feed_info.feed_publisher_name` | «Technologies LLC» → **«malin.kiev.ua (Technologies LLC)»** |
| transitous.org/sources, «under copyright of» | `attributions.txt` | «malin.kiev.ua — Serhii Merenkov / Technologies LLC» (уже так) |
| transitous.org/sources, рядок атрибуції | `license.attribution-text` у їхньому `feeds/ua.json` | «community feed by malin.kiev.ua» → наша офіційна атрибуція (PR, див. нижче) |

`feed_publisher_name` і запасний `agency_url` — у коді (`backend/src/gtfs-feed.ts`); **чинний `agency_url` живе в
`meta.agency` у базі**, його міняє адмін одним запитом (PUT усього датасету з `baseRevision`, як редактори):

```bash
API=https://kyiv-malyn-booking-production.up.railway.app
curl -s $API/transport/dataset > /tmp/ds.json
python3 - <<'EOF2'
import json
d = json.load(open('/tmp/ds.json')); d['baseRevision'] = d.pop('revision')
d['meta']['agency']['agency_url'] = 'https://malin.kiev.ua/transport'
json.dump(d, open('/tmp/ds-put.json', 'w'), ensure_ascii=False)
EOF2
curl -s -X PUT $API/transport/dataset -H "Authorization: Bearer $VIBER_ADMIN_TOKEN" -H 'content-type: application/json' --data-binary @/tmp/ds-put.json
curl -s $API/transport/gtfs/agency.txt   # має містити https://malin.kiev.ua/transport
```

Transitous підхопить нову `agency_url` при нічному імпорті.

## 3б. Transitous — PR на запис через Mobility Database (робить власник **руками**)

**Статус:** подано власником 2026-10-19 — PR <https://github.com/public-transport/transitous/pull/2610> (`mdb-3615`,
атрибуція «Data: malin.kiev.ua — Serhii Merenkov / Technologies LLC»).

Мейнтейнер додав фід як `http`-джерело; його ж правило — «use mobility database where possible», тож правильний запис
посилається на `mdb-3615` і несе нашу атрибуцію. **Увага:** `AI_POLICY.md` Transitous забороняє коміти з LLM-інструментів
і LLM-тексти в PR — правку, коміт і опис PR власник робить сам, тут лише факти. У `feeds/ua.json` замінити блок `malyn` на:

```json
        {
            "name": "malyn",
            "type": "mobility-database",
            "mdb-id": "mdb-3615",
            "license": {
                "url": "https://own-net.com/license.html",
                "attribution-text": "Дані: malin.kiev.ua — Сергій Меренков / ТОВ «Технології»"
            }
        }
```

Факти для опису PR (своїми словами, англійською): запис у Mobility Database `mdb-3615` злито 2026-10-19 (#1751), прямий
URL той самий, ліцензія OwnNet Source License 1.1 з обов'язковою атрибуцією, фід валідний (0 помилок у gtfs-validator 8.0.1).
Форк — `drivling/transitous`, гілка від `main`; у шаблоні PR поставити галочку про AI policy чесно.

## 4. Після реєстрації

- Записати дати подачі/мерджу в «Знахідки» `transport-open-protocols-2026-10.md` і в «Чого поки нема» →
  «Де зареєстровано» в [`../transport-open-data.md`](../transport-open-data.md).
- Раз на кілька місяців: `java -jar gtfs-validator-<ver>-cli.jar -i malyn-gtfs.zip -o report -c ua` — обидва
  каталоги самі ганяють валідатор і показують помилки на сторінці фіду.
- Що каталоги **не** зроблять через ліцензію: Google Maps / Apple Maps фід не візьмуть (потрібна ліцензія без
  share-alike) — прийнято власником у етапі 3.
