"""TTL cache with single-flight, circuit breaker and stale-serving (§6.3.2, §6.3.6)."""

from __future__ import annotations

import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

from ..providers.base import ProviderError, QuotaExceeded, UpstreamDegraded

T = TypeVar("T")


@dataclass
class Cached(Generic[T]):  # noqa: UP046
    value: T
    fetched_mono: float
    fetched_wall: float

    def age(self) -> float:
        return time.monotonic() - self.fetched_mono


class LiveCache:
    """One upstream call per key per TTL; concurrent callers share the flight.

    On failure the breaker opens (honouring Retry-After) and stale values are served
    for up to ``max_stale_s``; otherwise ``None`` — callers degrade to schedule-only.
    """

    def __init__(self, max_stale_s: int = 1800) -> None:
        self.max_stale_s = max_stale_s
        self._data: dict[str, Cached] = {}
        self._flights: dict[str, asyncio.Future] = {}
        self._open_until = 0.0
        self._fail_streak = 0
        self.hits = self.misses = 0
        self.last_error: str | None = None

    @property
    def breaker_open(self) -> bool:
        return time.monotonic() < self._open_until

    async def get(
        self, key: str, ttl_s: float, fetch: Callable[[], Awaitable[T]]
    ) -> Cached[T] | None:
        c = self._data.get(key)
        if c is not None and c.age() < ttl_s:
            self.hits += 1
            return c
        if self.breaker_open:
            return self._stale(key)
        if key in self._flights:
            try:
                return await asyncio.shield(self._flights[key])
            except Exception:  # noqa: BLE001
                return self._stale(key)
        self.misses += 1
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._flights[key] = fut
        try:
            value = await fetch()
            self._fail_streak = 0
            c = Cached(value, time.monotonic(), time.time())
            self._data[key] = c
            fut.set_result(c)
            return c
        except ProviderError as e:
            self._trip(e)
            fut.set_exception(e)
            fut.exception()  # mark retrieved
            return self._stale(key)
        finally:
            self._flights.pop(key, None)

    def _trip(self, e: ProviderError) -> None:
        self._fail_streak += 1
        self.last_error = e.code
        if isinstance(e, QuotaExceeded | UpstreamDegraded) and e.retry_after_s:
            delay = float(e.retry_after_s)
        else:
            delay = min(300.0, 5 * 2 ** min(self._fail_streak, 6))
        self._open_until = time.monotonic() + delay * (0.8 + 0.4 * random.random())  # noqa: S311

    def _stale(self, key: str) -> Cached | None:
        c = self._data.get(key)
        return c if c is not None and c.age() <= self.max_stale_s else None
