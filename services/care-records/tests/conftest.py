"""Real Postgres + real Kafka via Testcontainers — no mocked DB, no fake broker.

Containers start once per session, before any `app.*` module is imported,
because `app/db/session.py` builds its engine at import time from
CARE_DATABASE_URL. Setting env vars here (module scope, executes at
collection) then migrating with the real `alembic upgrade head` is the same
path the built service uses in production — no schema drift between test and
prod.
"""

import os
import subprocess
import sys
from pathlib import Path

from testcontainers.kafka import KafkaContainer
from testcontainers.postgres import PostgresContainer

SERVICE_ROOT = Path(__file__).resolve().parent.parent

_pg = PostgresContainer("postgres:17-alpine")
_pg.start()

_kafka = KafkaContainer("confluentinc/cp-kafka:7.6.0")
_kafka.start()

database_url = (
    f"postgresql+psycopg://{_pg.username}:{_pg.password}"
    f"@{_pg.get_container_host_ip()}:{_pg.get_exposed_port(5432)}/{_pg.dbname}"
)
broker_list = _kafka.get_bootstrap_server()

os.environ["CARE_DATABASE_URL"] = database_url
os.environ["CARE_KAFKA_BROKERS"] = broker_list

subprocess.run(
    [sys.executable, "-m", "alembic", "upgrade", "head"],
    cwd=SERVICE_ROOT,
    check=True,
)


def pytest_sessionfinish(session, exitstatus):
    _kafka.stop()
    _pg.stop()
