"""Tenant-scoped timing and frequency recommendations."""

from habitloop_shared.app_factory import create_app

from app.routes import router

app = create_app("recommendation-service", "/api/recommendations")
app.include_router(router)
