"""
Тести модерації Джури — без мережі, telethon і бази.

  cd backend/telegram-user && python3 -m dzhura.test_moderation
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dzhura.moderation import (  # noqa: E402
    ModerationPlan,
    about_admin,
    build_user_text,
    eligible_targets,
    format_draft,
    name_stems,
    parse_plan,
    parse_protected,
    quiet_hours,
)
from dzhura.moderator import Moderator  # noqa: E402

IRADA, SOFIA, A, B = 111, 222, 333, 444
PROTECTED_RAW = [
    {"tgUserId": str(IRADA), "name": "Ирада", "role": "голова правління, адмін"},
    {"tgUserId": str(SOFIA), "name": "Софія", "role": "помічниця"},
    {"tgUserId": "не число"},
]
PROTECTED = parse_protected(PROTECTED_RAW)
# 06.08 19:44 за Києвом = 16:44 UTC
T0 = datetime(2026, 8, 6, 16, 44)


def row(mid, minutes, uid, text, *, name=None, reply=None, out=False, deleted=False):
    return {
        "tg_message_id": mid,
        "is_outgoing": out,
        "text": text,
        "media_kind": None,
        "reply_to_tg_message_id": reply,
        "sent_at": T0 + timedelta(minutes=minutes),
        "deleted_at": T0 if deleted else None,
        "sender_tg_id": uid,
        "sender_name": name or {IRADA: "Ирада", SOFIA: "Софія", A: "13942", B: "Маргарита"}.get(uid, str(uid)),
    }


def flood_rows():
    return [
        row(1, -200, A, "Голова правління заявку зробила.", name="Вікторія"),
        row(2, 0, A, "Зато у нас есть генератор. А председатель ушла в подполье."),
        row(3, 3, B, "уже в 2 раза повысили оплату и что?"),
        row(4, 31, B, "Де наш председатель?"),
        row(5, 50, B, "Так надо сейчас что то делать, у нас председатель есть или нет?"),
    ]


def test_protected_and_stems():
    assert [p["tg_user_id"] for p in PROTECTED] == [IRADA, SOFIA]
    stems = name_stems(PROTECTED)
    assert sorted(stems) == sorted(["іра", "ира", "соф"]), stems


def test_about_admin():
    rows = flood_rows() + [row(6, 51, A, "ок", reply=99), row(99, -10, IRADA, "Заявку подано")]
    by_tg = {r["tg_message_id"]: r for r in rows}
    ids = {IRADA, SOFIA}
    stems = name_stems(PROTECTED)
    assert about_admin(by_tg[2], by_tg, ids, stems)  # «председатель»
    assert not about_admin(by_tg[3], by_tg, ids, stems)
    assert about_admin(by_tg[6], by_tg, ids, stems)  # відповідь на повідомлення Ирады
    assert about_admin(row(7, 0, A, "Читайте пост Ираіди"), by_tg, ids, stems)
    assert about_admin(row(8, 0, A, "Ірадо, дякуємо"), by_tg, ids, stems)
    assert not about_admin(row(9, 0, A, "Будемо збирати гроші"), by_tg, ids, stems)  # «ира» всередині слова


def test_eligible_waits_and_respects_admin_reply():
    rows = flood_rows()
    now = T0 + timedelta(minutes=56)
    related, eligible = eligible_targets(rows, PROTECTED, now)
    assert [r["tg_message_id"] for r in related] == [2, 4, 5]
    # #5 ще свіже (6 хв), #2 і #4 — старші за 15 хв
    assert [r["tg_message_id"] for r in eligible] == [2, 4]
    # адміністрація відповіла після #2 — на #2 уже не відповідаємо, а #4 прийшло вже після її відповіді
    rows2 = rows + [row(10, 20, IRADA, "Я тут, заявку подала")]
    _, eligible2 = eligible_targets(rows2, PROTECTED, now)
    assert [r["tg_message_id"] for r in eligible2] == [4]
    # власник (вихідне) теж адміністрація
    rows3 = rows + [row(11, 40, None, "Добрий вечір", out=True)]
    _, eligible3 = eligible_targets(rows3, PROTECTED, now)
    assert [r["tg_message_id"] for r in eligible3] == []
    # видалене й наш імпорт не рахуються
    rows4 = rows + [row(12, 1, A, "председатель!", deleted=True), row(13, 1, 0, "председатель", name="Imported Message")]
    related4, _ = eligible_targets(rows4, PROTECTED, now)
    assert 12 not in [r["tg_message_id"] for r in related4] and 13 not in [r["tg_message_id"] for r in related4]
    # поріг 12 хв: #5 (о +50) через 11 хв ще ні, через 13 — так
    _, e11 = eligible_targets(rows, PROTECTED, T0 + timedelta(minutes=61))
    _, e13 = eligible_targets(rows, PROTECTED, T0 + timedelta(minutes=63))
    assert 5 not in [r["tg_message_id"] for r in e11] and 5 in [r["tg_message_id"] for r in e13]
    # старше 3 год — уже не актуальне
    _, eligible5 = eligible_targets(rows, PROTECTED, T0 + timedelta(hours=4))
    assert eligible5 == []


def test_quiet_hours():
    assert quiet_hours(datetime(2026, 11, 23, 21, 30, tzinfo=timezone.utc))  # 23:30 Київ
    assert quiet_hours(datetime(2026, 11, 23, 5, 0, tzinfo=timezone.utc))  # 07:00 Київ
    assert not quiet_hours(datetime(2026, 11, 23, 6, 0, tzinfo=timezone.utc))  # 08:00 Київ


def test_parse_plan():
    ok = parse_plan('{"action":"intervene","target_message_id":2,"target_name":"13942","hint":"жарт","warning":"⚠️","reason":"флуд"}', {2, 4})
    assert ok.intervene and ok.target_message_id == 2 and ok.warning == "⚠️"
    assert not parse_plan({"action": "intervene", "target_message_id": 5, "hint": "x"}, {2, 4}).intervene
    assert not parse_plan({"action": "intervene", "target_message_id": 2, "hint": ""}, {2}).intervene
    assert parse_plan("не json").action == "skip"
    assert parse_plan({"action": "skip", "reason": "по ділу"}).reason == "по ділу"


def test_user_text_marks_and_admin():
    rows = flood_rows() + [row(20, -100, IRADA, "Оголошення")]
    text = build_user_text(
        rows,
        chat_title="ОСББ",
        protected=PROTECTED,
        note="Внески — це ліфти й прибирання.",
        eligible_ids={2},
        samples={"Маргарита": ["Свет есть?", "Ясно"]},
        now=T0 + timedelta(minutes=56),
    )
    assert "#2 [06.08 19:44] 13942 (можна відповісти):" in text
    assert "Ирада [адміністрація]" in text
    assert "Ирада — голова правління, адмін" in text
    assert "Підказка власника: Внески" in text
    assert "— Маргарита: Свет есть? | Ясно" in text


def test_format_draft_escapes():
    plan = ModerationPlan("intervene", 2, "13942", "В <подполье> & РТП", "⚠️ Попередження", "флуд")
    html = format_draft("ОСББ <4>", row(2, 0, A, "a<b>"), plan, link="https://t.me/c/1/2", warning_dropped=False)
    assert "ОСББ &lt;4&gt;" in html and "a&lt;b&gt;" in html and "В &lt;подполье&gt; &amp; РТП" in html
    assert '<a href="https://t.me/c/1/2">13942, 06.08 19:44</a>' in html
    assert "2. Окремим повідомленням" in html
    dropped = format_draft("ОСББ", row(2, 0, A, "a"), plan, warning_dropped=True)
    assert "Попередження за флуд пропущено" in dropped and "2. Окремим" not in dropped


class FakeDB:
    def __init__(self, rows):
        self.rows = rows
        self.log = []
        self.saved = []
        self.person_done = set()
        self.last_warning = None

    async def moderation_rows(self, chat_id, until, limit, hours):
        u = until.replace(tzinfo=None) if until.tzinfo else until
        return [r for r in self.rows if r["sent_at"] <= u]

    async def person_samples(self, chat_id, ids, before, per_person):
        return {i: ["приклад"] for i in ids}

    async def moderation_calls_since(self, chat_id, since):
        return len(self.log)

    async def moderation_person_since(self, chat_id, uid, since):
        return uid in self.person_done

    async def moderation_last_warning(self, chat_id):
        return self.last_warning

    async def insert_moderation(self, chat_id, kind, **kw):
        if kw.get("target_tg_message_id") is not None and any(
            e[1].get("target_tg_message_id") == kw["target_tg_message_id"] for e in self.log
        ):
            return False
        self.log.append((kind, kw))
        return True

    async def enqueue_saved(self, html):
        self.saved.append(html)


CHAT = {
    "id": 7,
    "tg_chat_id": -1002639133974,
    "kind": "supergroup",
    "title": "ОСББ",
    "moderation_mode": "drafts",
    "moderation_note": "нотатка",
    "moderation_protected": PROTECTED_RAW,
}


def test_moderator_draft_flow():
    async def run():
        db = FakeDB(flood_rows())
        calls = []

        async def fake_decide(rows, **kw):
            calls.append(kw)
            return ModerationPlan("intervene", 2, "13942", "натяк", "⚠️ попередження", "тролінг + флуд")

        cap = type("Cap", (), {"watched": {CHAT["tg_chat_id"]: CHAT}})()
        m = Moderator(db, cap, decide_fn=fake_decide, api_key="sk-test")
        now = (T0 + timedelta(minutes=56)).replace(tzinfo=timezone.utc)
        await m.tick(now)
        assert len(calls) == 1 and calls[0]["eligible_ids"] == {2, 4}
        assert calls[0]["samples"] == {"13942": ["приклад"], "Маргарита": ["приклад"]}
        assert db.log[0][0] == "draft" and db.log[0][1]["target_tg_user_id"] == A
        assert len(db.saved) == 1 and "натяк" in db.saved[0] and "t.me/c/2639133974/2" in db.saved[0]
        # той самий набір кандидатів — модель удруге не питаємо
        await m.tick(now + timedelta(minutes=5))
        assert len(calls) == 1
        # уночі не перевіряємо
        db.rows.append(row(30, 70, B, "председатель где?"))
        await m.tick(datetime(2026, 8, 6, 21, 0, tzinfo=timezone.utc))
        assert len(calls) == 1

    asyncio.run(run())


def test_moderator_limits():
    async def run():
        db = FakeDB(flood_rows())
        db.person_done = {A}
        db.last_warning = T0 + timedelta(minutes=10)

        async def fake_decide(rows, **kw):
            return ModerationPlan("intervene", 2, "13942", "натяк", "⚠️", "флуд")

        cap = type("Cap", (), {"watched": {CHAT["tg_chat_id"]: CHAT}})()
        m = Moderator(db, cap, decide_fn=fake_decide, api_key="sk-test")
        await m.tick((T0 + timedelta(minutes=56)).replace(tzinfo=timezone.utc))
        assert db.log[0][0] == "skip" and "вже була відповідь" in db.log[0][1]["reason"] and not db.saved

        db2 = FakeDB(flood_rows())
        db2.last_warning = T0 + timedelta(minutes=10)  # попередження було 46 хв тому
        m2 = Moderator(db2, cap, decide_fn=fake_decide, api_key="sk-test")
        await m2.tick((T0 + timedelta(minutes=56)).replace(tzinfo=timezone.utc))
        assert db2.log[0][0] == "draft" and db2.log[0][1]["warning"] is None
        assert "пропущено" in db2.saved[0]

        db3 = FakeDB(flood_rows())

        async def skip_decide(rows, **kw):
            return ModerationPlan("skip", reason="по ділу")

        m3 = Moderator(db3, cap, decide_fn=skip_decide, api_key="sk-test")
        await m3.tick((T0 + timedelta(minutes=56)).replace(tzinfo=timezone.utc))
        assert db3.log[0][0] == "skip" and db3.log[0][1]["reason"] == "по ділу" and not db3.saved

        # без ключа — нічого
        m4 = Moderator(FakeDB(flood_rows()), cap, decide_fn=fake_decide, api_key="")
        assert not m4.available

    asyncio.run(run())


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK   {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {t.__name__}: {type(e).__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
