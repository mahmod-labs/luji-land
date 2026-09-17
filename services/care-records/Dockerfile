FROM python:3.13-slim

WORKDIR /app

# Install runtime deps from pyproject (the app package itself is copied after,
# so this layer caches across code changes).
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic-settings>=2.6" \
    "sqlalchemy[asyncio]>=2.0" "psycopg[binary]>=3.2" "aiokafka>=0.12" "alembic>=1.14"

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# Migrate independently, then start (rule 6 + SKILL). alembic env reads
# CARE_DATABASE_URL, so the same URL migrates and serves.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 3002"]
