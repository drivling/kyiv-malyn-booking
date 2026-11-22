#!/usr/bin/env python3
"""Орієнтири Коростеня для «Доведе» (Docs/dovede-learning-roadmap.md, крок 7б): магазини, аптеки, школи, установи —
місця без власної зупинки, які люди називають словами («до АТБ», «до школи 5»). Зі знімка OpenStreetMap
(`osm/places.json`, пише `../dovede-streets/fetch_osm.py`) і ручних рішень `config.json` будує

  frontend/src/pages/DovedePage/data/korosten-landmarks.json  — назва, як її кажуть, точка

Генератор спільний із Малином (`data/malyn-transport/dovede-landmarks/build.py`, функція `build`); серверної копії
назв немає — промпт Claude для Коростеня орієнтирів не містить.

Запуск з кореня репозиторію:  python3 data/korosten-transport/dovede-landmarks/build.py
Дані © учасники OpenStreetMap, ліцензія ODbL (див. README.md поруч). Мережі не потребує.
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

spec = importlib.util.spec_from_file_location('malyn_landmarks_build', os.path.join(ROOT, 'data', 'malyn-transport', 'dovede-landmarks', 'build.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

ABOUT = ('Орієнтири Коростеня для «Доведе»: місця без власної зупинки (магазини, аптеки, установи, підприємства) — '
         'назва, як її кажуть, точка. Згенеровано data/korosten-transport/dovede-landmarks/build.py з OSM-знімка '
         'і config.json; не редагувати вручну.')

if __name__ == '__main__':
    shared.build(
        here=HERE,
        osm=os.path.join(HERE, 'osm'),
        out_front=os.path.join(ROOT, 'frontend', 'src', 'pages', 'DovedePage', 'data', 'korosten-landmarks.json'),
        out_back=None,
        about=ABOUT,
        city_adj='Коростенський',
    )
