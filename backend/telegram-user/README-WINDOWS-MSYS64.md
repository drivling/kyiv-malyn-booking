# Windows + MSYS64: віртуальне середовище (venv) для telegram-user

У MSYS2 Python захищений (PEP 668): пакети **не можна** ставити системно (`pip install -r requirements.txt` дасть помилку `externally-managed-environment`). Потрібно використовувати **віртуальне середовище**.

---

## Що зробити

### 1. Перейти в каталог проєкту

```bash
cd /home/Note/projects/kyiv-malyn-booking/backend/telegram-user
```

(або ваш шлях до `backend/telegram-user`)

### 2. Створити віртуальне середовище

Один раз:

```bash
python -m venv .venv
```

Це створить папку `.venv` у `backend/telegram-user`.

### 3. Активувати venv

У **MSYS2** (bash або zsh) venv має Unix-структуру — скрипт лежить у **bin**, не в Scripts:

```bash
source .venv/bin/activate
```

Після цього в рядку запрошення з’явиться `(.venv)` — значить, ви в середовищі.

### 4. Встановити залежності

```bash
pip install -r requirements.txt
```

Тепер `pip` встановлює пакети **тільки в .venv**, помилки `externally-managed-environment` не буде.

### 5. Запустити авторизацію сесії

Не закриваючи термінал (venv має бути активований):

```bash
export TELEGRAM_API_ID="35082143"
export TELEGRAM_API_HASH="8095eb80857cacd09c29c7891d1bf4e5"
python auth_session.py
```

Ввести номер телефону, код з Telegram, 2FA (якщо є). Після успіху з’являться файли сесії в поточній папці.

### 6. Далі — як у головному README

- Додати в git: `session_telegram_user.session`
- На Railway задати `TELEGRAM_API_ID` та `TELEGRAM_API_HASH`
- Решту кроків див. у [README.md](./README.md)

---

## Наступні рази (коли знову потрібен цей проєкт)

1. Перейти в каталог:
   ```bash
   cd /home/Note/projects/kyiv-malyn-booking/backend/telegram-user
   ```
2. Активувати venv:
   ```bash
   source .venv/bin/activate
   ```
3. Далі можна запускати `python auth_session.py`, `python test_resolve_phone.py` тощо — пакети вже встановлені в `.venv`.

---

## Якщо використовуєте PowerShell (не MSYS2 bash)

У PowerShell активація venv інша:

```powershell
cd C:\msys64\home\Note\projects\kyiv-malyn-booking\backend\telegram-user
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:TELEGRAM_API_ID="35082143"
$env:TELEGRAM_API_HASH="8095eb80857cacd09c29c7891d1bf4e5"
python auth_session.py
```

Якщо скрипт активації заблоковано політикою, спочатку виконайте (один раз, від імені адміна):  
`Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

---

## Коротко

| Крок | Команда |
|------|--------|
| Створити venv (один раз) | `python -m venv .venv` |
| Увімкнути venv (MSYS2 bash/zsh) | `source .venv/bin/activate` |
| Увімкнути venv (PowerShell) | `.\.venv\Scripts\Activate.ps1` |
| Встановити пакети | `pip install -r requirements.txt` |
| Запустити авторизацію | `python auth_session.py` (після export змінних) |

**Не використовуйте** `--break-system-packages` — це може зламати системний Python MSYS2. Завжди працюйте через venv.
