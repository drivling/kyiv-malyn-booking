"""
Тести автовідповіді Джури — без мережі, telethon і бази.

  cd backend/telegram-user && python3 -m dzhura.test_autoreply
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dzhura.autoreply import (  # noqa: E402
    DEFAULT_MODEL,
    ReplyPlan,
    build_user_text,
    format_transcript,
    generate_reply,
    has_text,
    model_name,
    parse_plan,
    pending_incoming,
    typing_seconds,
)
from dzhura.responder import (  # noqa: E402
    AutoResponder,
    clamp_delay,
    format_notice,
    kyiv_day_start_utc,
)

T0 = datetime(2026, 11, 9, 22, 0, 0)  # naive UTC = 00:00 10.11 за Києвом


def row(tg_id, text, *, out=False, auto=False, minute=0, media=None, reply_to=None, deleted=False):
    return {
        "tg_message_id": tg_id,
        "is_outgoing": out,
        "is_auto_reply": auto,
        "text": text,
        "media_kind": media,
        "reply_to_tg_message_id": reply_to,
        "sent_at": T0 + timedelta(minutes=minute),
        "deleted_at": T0 if deleted else None,
    }


DIALOG = [
    row(1, "Привет", minute=0),
    row(2, "сек", out=True, minute=1),
    row(3, "гляну позже", out=True, auto=True, minute=2),
    row(4, "Когда увидимся", minute=3),
    row(5, "", minute=4, media="photo"),
    row(6, "Хочу кофе", minute=5, reply_to=4),
]


# ---------------- листування й рішення ----------------


def test_pending_incoming_is_what_the_owner_has_not_answered():
    assert [r["tg_message_id"] for r in pending_incoming(DIALOG)] == [4, 5, 6]
    assert pending_incoming([*DIALOG, row(7, "ок", out=True, minute=6)]) == []
    # видалене співрозмовником повідомлення вже нікому не видно — відповідати нема на що
    assert pending_incoming([row(1, "сек", out=True), row(2, "ой не туда", minute=1, deleted=True)]) == []


def test_has_text_false_for_media_only():
    assert has_text(pending_incoming(DIALOG)) is True
    assert has_text([row(1, "", media="voice"), row(2, "  ", media="photo")]) is False


def test_transcript_marks_owner_auto_media_reply_and_pending_part():
    text = format_transcript(DIALOG, "Оля")
    assert text.splitlines() == [
        "[10.11 00:00] Оля: Привет",
        "[10.11 00:01] Я: сек",
        "[10.11 00:02] Я (авто): гляну позже",
        "--- після цього власник ще не відповідав ---",
        "[10.11 00:03] Оля: Когда увидимся",
        "[10.11 00:04] Оля: [фото]",
        "[10.11 00:05] Оля: (у відповідь на «Когда увидимся») Хочу кофе",
    ]


def test_transcript_clips_long_text_and_skips_deleted():
    rows = [row(1, "x" * 2000), row(2, "удалено", minute=1, deleted=True)]
    lines = format_transcript(rows, "Оля").splitlines()
    assert len(lines) == 1 and lines[0].endswith("…") and len(lines[0]) < 760


def test_user_text_carries_time_names_and_note():
    text = build_user_text(
        DIALOG,
        peer_name="Оля",
        owner_name="Serg",
        note="  університетська подруга, жартуємо  ",
        now=datetime(2026, 11, 10, 7, 5, tzinfo=timezone.utc),
    )
    assert "Співрозмовник — Оля. Власник — Serg." in text
    assert "Зараз: вівторок, 10.11.2026 09:05 (Київ)." in text
    assert "Підказка власника про цей чат: університетська подруга, жартуємо" in text
    assert "Підказка" not in build_user_text(DIALOG, peer_name="Оля", owner_name=None, note=" ", now=T0)


def test_parse_plan_limits_messages_and_falls_back_to_silence():
    plan = parse_plan({"action": "reply", "messages": [" а ", "", "б", "в", "г"], "reason": "жарт у відповідь"})
    assert plan.is_reply and plan.messages == ["а", "б", "в"] and plan.reason == "жарт у відповідь"
    assert parse_plan({"action": "skip", "messages": ["зайве"], "reason": "питає, чи це бот"}).is_reply is False
    assert parse_plan({"action": "reply", "messages": [], "reason": ""}).action == "skip"
    assert parse_plan("не json").action == "skip"
    assert parse_plan('```json\n{"action":"reply","messages":["ок"],"reason":"r"}\n```').messages == ["ок"]
    long = parse_plan({"action": "reply", "messages": ["я" * 5000], "reason": ""}).messages[0]
    assert len(long) == 700 and long.endswith("…")


def test_typing_seconds_is_bounded():
    assert typing_seconds("ок") == 1.5
    assert typing_seconds("x" * 40) == 4.8
    assert typing_seconds("x" * 1000) == 9.0
    assert typing_seconds("x" * 1000, jitter=1.0) == 10.5


def test_model_name_only_claude():
    old = os.environ.get("DZHURA_AUTOREPLY_MODEL")
    try:
        os.environ["DZHURA_AUTOREPLY_MODEL"] = "gpt-4o"
        assert model_name() == DEFAULT_MODEL == "claude-opus-5-5"
        os.environ["DZHURA_AUTOREPLY_MODEL"] = "claude-haiku-5-5"
        assert model_name() == "claude-haiku-5-5"
    finally:
        if old is None:
            os.environ.pop("DZHURA_AUTOREPLY_MODEL", None)
        else:
            os.environ["DZHURA_AUTOREPLY_MODEL"] = old


class _FakeClaude:
    def __init__(self, payload, stop_reason="end_turn"):
        outer = self

        class _Messages:
            async def create(self, **kw):
                outer.request = kw
                text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
                return SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)])

        self.beta = SimpleNamespace(messages=_Messages())
        self.request = None


def test_generate_reply_request_and_answer():
    fake = _FakeClaude({"action": "reply", "messages": ["на неделе наберу"], "reason": "без конкретики"})
    plan = asyncio.run(generate_reply(DIALOG, peer_name="Оля", owner_name="Serg", note="подруга", client=fake))
    assert plan.is_reply and plan.messages == ["на неделе наберу"]
    req = fake.request
    assert req["model"] == "claude-opus-5-5"
    assert req["fallbacks"] == "default" and req["betas"] == ["server-side-fallback-2026-07-01"]
    assert req["output_config"]["format"]["schema"]["required"] == ["action", "messages", "reason"]
    assert "temperature" not in req and "thinking" not in req
    assert "чи з ним говорить людина" in req["system"] and "не обіцяй" in req["system"]
    user = req["messages"][0]["content"]
    assert "Хочу кофе" in user and "Підказка власника про цей чат: подруга" in user


def test_generate_reply_refusal_is_silence():
    fake = _FakeClaude({}, stop_reason="refusal")
    assert asyncio.run(generate_reply(DIALOG, peer_name="Оля", client=fake)).is_reply is False


# ---------------- таймер і надсилання ----------------

CHAT = {
    "id": 13,
    "tg_chat_id": 777,
    "kind": "private",
    "title": "Оля",
    "auto_reply": True,
    "auto_reply_delay_sec": 80,
    "auto_reply_note": "подруга",
}


class _FakeDb:
    def __init__(self, rows, sent_today=0):
        self.rows = list(rows)
        self.sent_today = sent_today
        self.saved: list[str] = []
        self.auto_marked: list[int] = []

    async def recent_messages(self, chat_id, limit):
        return self.rows[-limit:]

    async def count_auto_replies_since(self, chat_id, since):
        return self.sent_today

    async def enqueue_saved(self, html):
        self.saved.append(html)

    async def mark_auto_reply(self, chat_id, tg_message_id):
        self.auto_marked.append(tg_message_id)

    async def person_access_hash(self, tg_user_id):
        return None


class _FakeTelegram:
    def __init__(self):
        self.calls: list[tuple] = []
        self.next_id = 100

    async def get_input_entity(self, cid):
        return f"peer:{cid}"

    async def send_read_acknowledge(self, peer, max_id=None):
        self.calls.append(("read", peer, max_id))

    def action(self, peer, kind):
        calls = self.calls

        class _Ctx:
            async def __aenter__(self):
                calls.append(("typing", peer))

            async def __aexit__(self, *exc):
                return False

        return _Ctx()

    async def send_message(self, peer, text, parse_mode="unset"):
        self.next_id += 1
        self.calls.append(("send", peer, text, parse_mode))
        return SimpleNamespace(id=self.next_id, message=text, out=True)


class _FakeCap:
    def __init__(self, chat):
        self.watched = {chat["tg_chat_id"]: chat}
        self.queue: asyncio.Queue = asyncio.Queue()
        self.stored: list[int] = []

    async def store_message(self, chat, msg, *, source, relay):
        assert relay is False
        self.stored.append(msg.id)
        return 1, True


def _incoming(text="Когда увидимся", *, age_sec=0):
    return SimpleNamespace(out=False, message=text, date=datetime.now(timezone.utc) - timedelta(seconds=age_sec))


def _outgoing(text):
    return SimpleNamespace(out=True, message=text, date=datetime.now(timezone.utc))


def _setup(plan=None, *, rows=DIALOG, chat=CHAT, sent_today=0, generate=None, api_key="sk-test"):
    """Responder на фейках; sleep миттєвий, але віддає керування циклу."""
    tg, db, cap = _FakeTelegram(), _FakeDb(rows, sent_today), _FakeCap(chat)
    slept: list[float] = []
    calls: list[dict] = []

    async def fake_sleep(seconds):
        slept.append(seconds)
        await asyncio.sleep(0)

    async def default_generate(rows_, **kw):
        calls.append({"rows": rows_, **kw})
        return plan or ReplyPlan("reply", ["на неделе наберу", "наверное"], "без обіцянок")

    r = AutoResponder(
        tg, db, cap, owner_name="Serg", generate=generate or default_generate, sleep=fake_sleep, rnd=lambda: 0.0,
        api_key=api_key,
    )
    return r, tg, db, cap, slept, calls


async def _settle(r):
    for _ in range(50):
        await asyncio.sleep(0)
        if not r._timers and not r._sending:
            return
    raise AssertionError("автовідповідь не завершилась")


def test_owner_silent_reads_types_sends_stores_and_reports():
    async def run():
        r, tg, db, cap, slept, calls = _setup()
        r.on_message(CHAT, _incoming("Хочу кофе"))
        await _settle(r)
        assert slept[0] == 80  # затримка з чату
        assert calls[0]["peer_name"] == "Оля" and calls[0]["owner_name"] == "Serg" and calls[0]["note"] == "подруга"
        assert tg.calls == [
            ("read", "peer:777", 6),  # «прочитано» до останнього вхідного — і лише перед відповіддю
            ("typing", "peer:777"),
            ("send", "peer:777", "на неделе наберу", None),
            ("typing", "peer:777"),
            ("send", "peer:777", "наверное", None),
        ]
        assert cap.stored == [101, 102] and db.auto_marked == [101, 102]
        assert len(db.saved) == 1
        assert db.saved[0].splitlines() == [
            "🤖 <b>Автовідповідь</b> · Оля",
            "← Хочу кофе",
            "→ на неделе наберу",
            "→ наверное",
            "<i>без обіцянок</i>",
        ]

    asyncio.run(run())


def test_owner_reply_before_timer_cancels_and_model_is_not_called():
    async def run():
        r, tg, db, cap, slept, calls = _setup()
        r.on_message(CHAT, _incoming())
        r.on_message(CHAT, _outgoing("сам відповім"))
        await _settle(r)
        assert calls == [] and tg.calls == [] and db.saved == []

    asyncio.run(run())


def test_new_incoming_restarts_timer_one_answer():
    async def run():
        r, tg, db, cap, slept, calls = _setup()
        r.on_message(CHAT, _incoming("раз"))
        r.on_message(CHAT, _incoming("два"))
        await _settle(r)
        assert len(calls) == 1 and [c[0] for c in tg.calls].count("send") == 2

    asyncio.run(run())


def test_owner_reply_while_model_thinks_discards_answer():
    async def run():
        holder: dict = {}

        async def slow_generate(rows_, **kw):
            holder["r"].on_message(CHAT, _outgoing("я тут"))  # власник відповів з телефона
            await asyncio.sleep(0)
            return ReplyPlan("reply", ["запізніла відповідь"], "")

        r, tg, db, cap, slept, calls = _setup(generate=slow_generate)
        holder["r"] = r
        r.on_message(CHAT, _incoming())
        await _settle(r)
        assert tg.calls == [] and db.saved == []

    asyncio.run(run())


def test_owner_reply_seen_only_in_db_discards_answer():
    """Подія про відповідь власника загубилась, але в базі вона вже є."""

    async def run():
        holder: dict = {}

        async def generate(rows_, **kw):
            holder["db"].rows.append(row(7, "вже відповів", out=True, minute=6))
            return ReplyPlan("reply", ["зайве"], "")

        r, tg, db, cap, slept, calls = _setup(generate=generate)
        holder["db"] = db
        r.on_message(CHAT, _incoming())
        await _settle(r)
        assert tg.calls == []

    asyncio.run(run())


def test_model_skip_sends_nothing_but_reports_reason():
    async def run():
        r, tg, db, cap, slept, calls = _setup(ReplyPlan("skip", [], "питає, чи це бот — відповість власник"))
        r.on_message(CHAT, _incoming("Хочу кофе"))
        await _settle(r)
        assert tg.calls == []
        assert db.saved[0].splitlines() == [
            "🤖 <b>Автовідповідь промовчала</b> · Оля",
            "← Хочу кофе",
            "<i>питає, чи це бот — відповість власник</i>",
        ]

    asyncio.run(run())


def test_no_call_for_media_only_last_word_owner_or_daily_cap():
    async def run():
        media_only = [row(1, "сек", out=True), row(2, "", minute=1, media="voice")]
        for kwargs in ({"rows": media_only}, {"rows": [*DIALOG, row(7, "ок", out=True, minute=6)]}, {"sent_today": 40}):
            r, tg, db, cap, slept, calls = _setup(**kwargs)
            r.on_message(CHAT, _incoming())
            await _settle(r)
            assert calls == [] and tg.calls == [] and db.saved == [], kwargs

    asyncio.run(run())


def test_ignored_when_off_not_private_stale_or_no_key():
    async def run():
        for chat, msg, key in (
            ({**CHAT, "auto_reply": False}, _incoming(), "sk"),
            ({**CHAT, "kind": "supergroup"}, _incoming(), "sk"),
            (CHAT, _incoming(age_sec=600), "sk"),
            (CHAT, _incoming(), ""),
        ):
            r, tg, db, cap, slept, calls = _setup(chat=chat, api_key=key)
            r.on_message(chat, msg)
            await asyncio.sleep(0)
            assert r._timers == {} and calls == [], (chat, key)

    asyncio.run(run())


def test_checkbox_removed_while_waiting():
    async def run():
        r, tg, db, cap, slept, calls = _setup()
        r.on_message(CHAT, _incoming())
        cap.watched[777] = {**CHAT, "auto_reply": False}
        await _settle(r)
        assert calls == [] and tg.calls == []

    asyncio.run(run())


def test_own_echo_does_not_cancel_but_owner_message_stops_the_series():
    async def run():
        r, tg, db, cap, slept, calls = _setup()
        original_send = tg.send_message

        async def send_and_echo(peer, text, parse_mode="unset"):
            sent = await original_send(peer, text, parse_mode=parse_mode)
            r.on_message(CHAT, _outgoing(text))  # Telegram повернув нашу ж репліку подією
            return sent

        tg.send_message = send_and_echo
        r.on_message(CHAT, _incoming())
        await _settle(r)
        assert [c[2] for c in tg.calls if c[0] == "send"] == ["на неделе наберу", "наверное"]

        r, tg, db, cap, slept, calls = _setup()
        original_send2 = tg.send_message

        async def send_then_owner(peer, text, parse_mode="unset"):
            sent = await original_send2(peer, text, parse_mode=parse_mode)
            r.on_message(CHAT, _outgoing("стоп, я сам"))
            return sent

        tg.send_message = send_then_owner
        r.on_message(CHAT, _incoming())
        await _settle(r)
        assert [c[2] for c in tg.calls if c[0] == "send"] == ["на неделе наберу"]
        assert "→ наверное" not in db.saved[0] and "→ на неделе наберу" in db.saved[0]

    asyncio.run(run())


def test_generation_error_is_reported_once():
    async def run():
        async def boom(rows_, **kw):
            raise RuntimeError("credit balance is too low")

        r, tg, db, cap, slept, calls = _setup(generate=boom)
        r.on_message(CHAT, _incoming())
        await _settle(r)
        r.on_message(CHAT, _incoming())
        await _settle(r)
        assert tg.calls == [] and len(db.saved) == 1
        assert "Автовідповідь не спрацювала" in db.saved[0] and "credit balance" in db.saved[0]

    asyncio.run(run())


def test_preview_asks_model_but_touches_nothing_in_telegram():
    async def run():
        r, tg, db, cap, slept, calls = _setup(ReplyPlan("reply", ["на неделе наберу"], "без обіцянок"))
        assert await r.preview(13) == {"action": "reply", "messages": ["на неделе наберу"], "reason": "без обіцянок"}
        assert tg.calls == [] and db.saved == [] and len(calls) == 1
        # останнє слово за власником — модель не питаємо
        r, tg, db, cap, slept, calls = _setup(rows=[*DIALOG, row(7, "ок", out=True, minute=6)])
        out = await r.preview(13)
        assert out["action"] == "skip" and calls == []
        for bad in (99, 13):
            r, tg, db, cap, slept, calls = _setup(chat={**CHAT, "kind": "private" if bad == 99 else "group"})
            try:
                await r.preview(bad)
            except ValueError:
                continue
            raise AssertionError("мало кинути ValueError")

    asyncio.run(run())


def test_helpers():
    assert clamp_delay(80) == 80 and clamp_delay(1) == 5 and clamp_delay(99999) == 3600 and clamp_delay(None) == 80
    # 10.11 01:30 за Києвом (UTC+2) → доба почалась 09.11 22:00 UTC
    assert kyiv_day_start_utc(datetime(2026, 11, 9, 23, 30, tzinfo=timezone.utc)) == datetime(2026, 11, 9, 22, 0)
    assert format_notice("A<b>", "x & y", ["<ok>"], "") == "🤖 <b>Автовідповідь</b> · A&lt;b&gt;\n← x &amp; y\n→ &lt;ok&gt;"


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
