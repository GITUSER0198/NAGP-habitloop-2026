"""Tenant-scoped challenges and participation."""

from habitloop_shared.app_factory import create_app

from app.routers.challenges import router

app = create_app("challenge-service", "/api/challenges")
app.include_router(router)
