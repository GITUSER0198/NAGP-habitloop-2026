"""Consistent lifecycle, health, logging and CORS for all six services."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from starlette.concurrency import run_in_threadpool
from starlette.responses import HTMLResponse

from habitloop_shared.config import get_settings
from habitloop_shared.db import initialize_database
from habitloop_shared.logging import RequestIDMiddleware, configure_logging


def create_app(name: str, prefix: str, *, use_database: bool = True) -> FastAPI:
    settings = get_settings()
    configure_logging(name, settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = await run_in_threadpool(initialize_database) if use_database else None
        if engine is not None:
            app.state.engine = engine
        try:
            yield
        finally:
            if engine is not None:
                engine.dispose()

    app = FastAPI(title=f"HabitLoop {name}", lifespan=lifespan)
    origins = [] if settings.web_port is None else [
        f"http://localhost:{settings.web_port}", f"http://127.0.0.1:{settings.web_port}",
    ]
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=True,
        allow_methods=["*"], allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestIDMiddleware)

    def health() -> dict[str, str]:
        return {"status": "ok", "service": name}

    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False)
    router = APIRouter(prefix=prefix)
    router.add_api_route("/health", health, methods=["GET"])
    app.include_router(router)

    @app.get(f"{prefix}/docs", include_in_schema=False)
    def prefixed_docs() -> HTMLResponse:
        return get_swagger_ui_html(openapi_url=f"{prefix}/openapi.json", title=app.title)

    app.add_api_route(f"{prefix}/openapi.json", app.openapi, include_in_schema=False)
    return app
