"""DynamoDB-backed analytics with no PostgreSQL lifecycle."""

from habitloop_shared.app_factory import create_app

from app.routes import router

app = create_app("analytics-service", "/api/analytics", use_database=False)
app.include_router(router)
