"""Challenge service scaffold."""

from habitloop_shared.app_factory import create_app

app = create_app("challenge-service", "/api/challenges")
