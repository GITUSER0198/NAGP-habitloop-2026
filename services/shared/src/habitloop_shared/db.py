"""Service-local SQLAlchemy sessions and bounded PostgreSQL startup retries."""

import logging
import time
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema

from habitloop_shared.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


@lru_cache
def _engine(database_url: str, schema: str) -> Engine:
    if database_url.startswith("sqlite"):
        return create_engine(
            database_url, connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
    return create_engine(
        database_url, pool_pre_ping=True,
        connect_args={"options": f"-csearch_path={schema},public", "connect_timeout": 5},
    )


def get_engine() -> Engine:
    settings = get_settings()
    return _engine(settings.database_url.get_secret_value(), settings.db_schema)


def initialize_database(attempts: int = 6, initial_delay: float = 0.5) -> Engine:
    if attempts < 1 or initial_delay < 0:
        raise ValueError("Database retry attempts must be positive and delay nonnegative")
    engine = get_engine()
    for attempt in range(1, attempts + 1):
        try:
            with engine.begin() as connection:
                if engine.dialect.name == "postgresql":
                    connection.execute(CreateSchema(get_settings().db_schema, if_not_exists=True))
                connection.execute(text("SELECT 1"))
                Base.metadata.create_all(connection)
            logger.info("database_ready")
            return engine
        except OperationalError:
            if attempt == attempts:
                logger.error("database_unavailable", extra={"fields": {"attempts": attempts}})
                # Avoid including credentials from driver errors in startup logs.
                raise RuntimeError(f"Database unavailable after {attempts} connection attempts") from None
            delay = min(initial_delay * 2 ** (attempt - 1), 8.0)
            logger.warning(
                "database_connect_retry",
                extra={"fields": {"attempt": attempt, "total_attempts": attempts, "retry_in_seconds": delay}},
            )
            time.sleep(delay)
    raise AssertionError("Unreachable")


def get_db() -> Iterator[Session]:
    with sessionmaker(bind=get_engine(), expire_on_commit=False)() as session:
        yield session
