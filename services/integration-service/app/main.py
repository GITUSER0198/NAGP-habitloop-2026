"""Wearable links and signed partner event ingestion."""

from habitloop_shared.app_factory import create_app

from app.routers.integrations import router

app = create_app("integration-service", "/api/integrations")
app.include_router(router)
