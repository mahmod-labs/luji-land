import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import load_config
from app.messaging.consumers.child_events import run_consumer

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_config()  # rule 6: fail to boot if config is missing
    stop = asyncio.Event()
    task = asyncio.create_task(run_consumer(stop))
    try:
        yield
    finally:
        stop.set()
        await task


app = FastAPI(title="care-records", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
