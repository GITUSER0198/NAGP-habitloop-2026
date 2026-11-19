"""Habits, schedules and occurrence logging."""

from habitloop_shared.app_factory import create_app

from app.routers.activities import router

app = create_app("activity-service", "/api/activities")
app.include_router(router)
