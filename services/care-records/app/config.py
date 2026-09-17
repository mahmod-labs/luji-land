"""Rule 6: config is validated at import — a missing setting refuses to boot."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CARE_", extra="ignore")

    # No defaults for the dependency addresses: absence must refuse to boot.
    # CARE_DATABASE_URL is a psycopg URL usable both sync (Alembic) and async
    # (the app engine): postgresql+psycopg://...
    database_url: str = Field(min_length=1)
    kafka_brokers: str = Field(min_length=1)

    # The service's own listen port keeps a default — it's a convention, not a
    # dependency address.
    port: int = 3002

    # A fixed consumer group so restarts resume from the committed offset
    # (catch-up), and earliest so a first boot replays history.
    kafka_group_id: str = "care-records"

    @property
    def broker_list(self) -> list[str]:
        return [b.strip() for b in self.kafka_brokers.split(",") if b.strip()]


@lru_cache
def load_config() -> Config:
    return Config()  # type: ignore[call-arg]  # values come from the environment
