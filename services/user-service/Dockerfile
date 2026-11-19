FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 SERVICE_PORT=47820
WORKDIR /app
COPY services/shared /opt/habitloop-shared
RUN pip install /opt/habitloop-shared
COPY services/user-service/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt && useradd --create-home --uid 10001 habitloop
COPY --chown=habitloop:habitloop services/user-service/app ./app
USER habitloop
EXPOSE ${SERVICE_PORT}
HEALTHCHECK --interval=10s --timeout=3s --start-period=45s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${SERVICE_PORT}/health', timeout=2)"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$SERVICE_PORT\" --no-access-log"]
