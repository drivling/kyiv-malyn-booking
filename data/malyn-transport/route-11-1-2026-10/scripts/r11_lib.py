"""Спільне для роботи над №11 (11/1): хелпери запису з audit-2026-10, але знімки бази — у route-11-1-2026-10/.
Запуск з кореня репозиторію: python3 data/malyn-transport/route-11-1-2026-10/scripts/<скрипт>.py [--apply]"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'audit-2026-10', 'scripts')))

import common  # noqa: E402

common.AUDIT = os.path.join('data', 'malyn-transport', 'route-11-1-2026-10')

from apply_lib import apply_change, chain, fetch, recalc, route_minutes, set_chains  # noqa: E402,F401
from geo_lib import side  # noqa: E402,F401

# Зупинки району Паперової фабрики (перевірено 2026-10-10)
PF, T8, T7 = 'st_0064', 'st_0108', 'st_0107'             # Паперова фабрика Вайдманн, №11 т.8, №11 т.7
NAT, P29, P9 = 'st_0047', 'st_0075', 'st_0078'           # на схід: Наталка, Приходька 29, Приходька 9
P8, P28, FBP = 'st_0077', 'st_0074', 'st_0076'           # на захід: Приходька 8, Приходька 28, ФБП
VIK, CH10, BAR = 'st_0043', 'st_0091', 'st_0007'         # Чорновола на схід: Вікторія, Чорновола 10, Барміна
MAZ27, MAZ3, MAZ4 = 'st_0024', 'st_0025', 'st_0026'      # Мазепи: 27 і 3 на північ, 4 на південь
T9, T10 = 'st_0121', 'st_0122'                           # нові технічні точки зворотного проїзду від фабрики
JUNCTION = (50.75751, 29.23995)                          # світлофор: Приходька × Мазепи × Чорновола
