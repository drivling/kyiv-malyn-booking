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

## 3. Після реєстрації

- Записати дати подачі/мерджу в «Знахідки» `transport-open-protocols-2026-10.md` і в «Чого поки нема» →
  «Де зареєстровано» в [`../transport-open-data.md`](../transport-open-data.md).
- Раз на кілька місяців: `java -jar gtfs-validator-<ver>-cli.jar -i malyn-gtfs.zip -o report -c ua` — обидва
  каталоги самі ганяють валідатор і показують помилки на сторінці фіду.
- Що каталоги **не** зроблять через ліцензію: Google Maps / Apple Maps фід не візьмуть (потрібна ліцензія без
  share-alike) — прийнято власником у етапі 3.
