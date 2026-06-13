FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN uv pip install --system --no-editable ".[full,bm25]"

COPY migrations ./migrations
COPY alembic.ini ./

EXPOSE 8010

CMD ["uvicorn", "aiteam.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8010"]
