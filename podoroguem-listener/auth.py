#!/usr/bin/env python3
"""Запускает проверенный авторизатор проекта для отдельной сессии PoDoroguem."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LEGACY_AUTH = ROOT / "backend" / "telegram-user" / "auth_session.py"
SESSION_BASE = Path(__file__).resolve().parent / "podoroguem_account"


if not LEGACY_AUTH.is_file():
    raise SystemExit(f"Не найден старый авторизатор: {LEGACY_AUTH}")

# Старый скрипт умеет обычный вход с кодом, retry, QR, 2FA, --fresh и gzip+base64 export.
# Передаём ему собственное имя файла, чтобы не задеть основную Telegram-сессию.
sys.argv = [str(LEGACY_AUTH), str(SESSION_BASE), *sys.argv[1:]]
runpy.run_path(str(LEGACY_AUTH), run_name="__main__")
