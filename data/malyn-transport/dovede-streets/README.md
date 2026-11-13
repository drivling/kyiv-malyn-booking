# Вулиці Малина для «Доведе»

`build.py` збирає з OSM-знімка жовтневого аудиту (`../audit-2026-10/osm/streets.json`, `addresses.json`) два файли:

- `frontend/src/pages/DovedePage/data/malyn-streets.json` — 271 вулиця: назва, тип, колишні назви (`old_name`), точка
  на вулиці, довжина, будинки з координатами (326 будинків на 73 вулицях — стільки адрес заповнено в OSM);
- `backend/src/dovede/streets.ts` — лише id і назви, для промпту Claude.

```bash
python3 data/malyn-transport/dovede-streets/build.py   # з кореня репозиторію, мережі не потребує
```

Обидва файли згенеровані — не редагувати вручну. Тест `frontend/.../nlu/streets.test.ts` звіряє списки id.
Id вулиці — трансліт назви (`street.horodyshchanska`, провулок — із суфіксом `-provulok`); після перейменування
вулиці в OSM id зміниться, стара назва лишиться в `old`.

Щоб оновити знімок OSM, потрібен Overpass (`../audit-2026-10/scripts/`); з хмарного середовища Claude Code він
недоступний — оновлювати з машини власника.

**Ліцензія даних:** © учасники OpenStreetMap, [ODbL 1.0](https://www.openstreetmap.org/copyright). Сторінка, що
показує адресу з цих даних, має згадувати OpenStreetMap.
