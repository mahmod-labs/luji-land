from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import load_config

_engine = create_async_engine(load_config().database_url, pool_pre_ping=True)
Session = async_sessionmaker(_engine, expire_on_commit=False)
