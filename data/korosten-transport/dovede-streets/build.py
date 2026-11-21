#!/usr/bin/env python3
"""Вулиці Коростеня для «Доведе» (Docs/dovede-learning-roadmap.md, крок 7а): зі знімка OpenStreetMap поруч
(`osm/streets.json`, `osm/addresses.json` — пише `fetch_osm.py`) будує

  frontend/src/pages/DovedePage/data/korosten-streets.json  — вулиця, колишні назви, точка, будинки з координатами

Генератор спільний із Малином (`data/malyn-transport/dovede-streets/build.py`, функція `build`); серверної копії
назв немає — промпт Claude для Коростеня вулиць не містить.

Запуск з кореня репозиторію:  python3 data/korosten-transport/dovede-streets/build.py
Дані © учасники OpenStreetMap, ліцензія ODbL (див. README.md поруч). Мережі не потребує.
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

spec = importlib.util.spec_from_file_location('malyn_streets_build', os.path.join(ROOT, 'data', 'malyn-transport', 'dovede-streets', 'build.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

ABOUT = ('Вулиці Коростеня для «Доведе»: назва, колишні назви, точка на вулиці, будинки з координатами '
         '(houses — вулицю вписано в OSM; near — привʼязано до вулиці за геометрією, може бути неточно). '
         'Згенеровано data/korosten-transport/dovede-streets/build.py з OSM-знімка; не редагувати вручну.')

if __name__ == '__main__':
    shared.build(
        osm=os.path.join(HERE, 'osm'),
        out_front=os.path.join(ROOT, 'frontend', 'src', 'pages', 'DovedePage', 'data', 'korosten-streets.json'),
        out_back=None,
        about=ABOUT,
    )
