"""Database readiness retries and schema isolation configuration."""

from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from habitloop_shared import db
from habitloop_shared.config import get_settings


def test_retry_connects_with_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = MagicMock()
    connection = MagicMock()
    engine.dialect.name = "postgresql"
    engine.begin.side_effect = [
        OperationalError("connect", None, Exception("not ready")),
        OperationalError("connect", None, Exception("not ready")),
        connection,
    ]
    delays: list[float] = []
    monkeypatch.setattr(db, "get_engine", lambda: engine)
    monkeypatch.setattr(db.time, "sleep", delays.append)
    assert db.initialize_database(attempts=3) is engine
    assert delays == [0.5, 1.0]
    assert engine.begin.call_count == 3
    schema_statement = connection.__enter__.return_value.execute.call_args_list[0].args[0]
    assert str(schema_statement) == "CREATE SCHEMA IF NOT EXISTS users"


def test_retry_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = MagicMock()
    engine.begin.side_effect = OperationalError("connect", None, Exception("not ready"))
    delays: list[float] = []
    monkeypatch.setattr(db, "get_engine", lambda: engine)
    monkeypatch.setattr(db.time, "sleep", delays.append)
    with pytest.raises(RuntimeError, match="Database unavailable after 3 connection attempts"):
        db.initialize_database(attempts=3)
    assert engine.begin.call_count == 3
    assert delays == [0.5, 1.0]


def test_engine_uses_service_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://localhost/habitloop")
    engines = []
    try:
        for schema in ("users", "activities"):
            monkeypatch.setenv("DB_SCHEMA", schema)
            get_settings.cache_clear()
            engine = db.get_engine()
            engines.append(engine)
            _, kwargs = engine.dialect.create_connect_args(engine.url)
            # The engine adds the service search path via connect_args, not URL mutation.
            assert "options" not in kwargs
            captured: dict[str, object] = {}

            def connect(*args: object, **options: object) -> None:
                captured.update(options)
                raise RuntimeError("intercepted")

            monkeypatch.setattr(engine.dialect, "connect", connect)
            with pytest.raises(RuntimeError, match="intercepted"):
                engine.connect()
            assert captured["options"] == f"-csearch_path={schema},public"
        assert engines[0] is not engines[1]
    finally:
        for engine in engines:
            engine.dispose()
        db._engine.cache_clear()


def test_invalid_schema_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DB_SCHEMA", "users;DROP SCHEMA public")
    get_settings.cache_clear()
    with pytest.raises(ValidationError, match="DB_SCHEMA"):
        get_settings()


def test_sqlite_session_fixture() -> None:
    db.initialize_database()
    session_iterator = db.get_db()
    session = next(session_iterator)
    assert session.scalar(text("SELECT 1")) == 1
    session_iterator.close()
