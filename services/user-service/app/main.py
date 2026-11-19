"""Tenant registration, authentication and user profiles."""

from habitloop_shared.app_factory import create_app

from app.routers.users import router

app = create_app("user-service", "/api/users")
app.include_router(router)
