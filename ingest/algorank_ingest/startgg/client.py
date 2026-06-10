"""HTTP client for the start.gg GraphQL API.

Behaviors:
  * sliding-window rate limiting (the API allows 80 req/60s),
  * exponential backoff on 429/5xx/network errors,
  * automatic removal of fields/arguments the live schema rejects
    (recorded in api_field_fallback),
  * ComplexityError raised so callers can shrink page sizes
    (the API caps responses at 1000 objects).
"""

from __future__ import annotations

import logging
from typing import Any, Callable

import httpx

from ..util import RateLimiter, backoff_sleep
from .gql import QuerySpec, classify_graphql_error, is_complexity_error

log = logging.getLogger("algorank.startgg")


class StartGGError(Exception):
    pass


class ComplexityError(StartGGError):
    pass


class FatalQueryError(StartGGError):
    pass


class StartGGClient:
    def __init__(
        self,
        url: str,
        token: str,
        rpm: int = 70,
        timeout: float = 60.0,
        on_fallback: Callable[[str, str, str, str], None] | None = None,
    ):
        self.url = url
        self.limiter = RateLimiter(rpm, 60.0)
        self.timeout = timeout
        self.on_fallback = on_fallback  # (query_name, kind, name, message)
        self._client = httpx.Client(
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "AlgoRank/0.1 (Melee results archive)",
            },
            timeout=timeout,
        )
        self.request_count = 0

    def close(self) -> None:
        self._client.close()

    def apply_known_fallbacks(self, spec: QuerySpec, fallbacks: list[dict]) -> None:
        for fb in fallbacks:
            if fb["query_name"] != spec.name:
                continue
            if fb["kind"] == "field":
                spec.drop_field(fb["name"])
            elif fb["kind"] == "argument":
                spec.drop_argument(fb["name"])
            elif fb["kind"] == "variable":
                spec.drop_variable(fb["name"])

    def _post(self, document: str, variables: dict[str, Any]) -> dict:
        attempt = 0
        while True:
            self.limiter.acquire()
            self.request_count += 1
            try:
                resp = self._client.post(
                    self.url, json={"query": document, "variables": variables}
                )
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                if attempt >= 8:
                    raise StartGGError(f"network failure after retries: {exc}") from exc
                log.warning("network error (%s), retrying", exc)
                backoff_sleep(attempt)
                attempt += 1
                continue
            if resp.status_code == 429:
                log.warning("rate limited by API, backing off")
                backoff_sleep(min(attempt, 4), base=15.0, cap=180.0)
                attempt += 1
                continue
            if resp.status_code in (500, 502, 503, 504, 520, 522, 524):
                if attempt >= 8:
                    raise StartGGError(f"server error {resp.status_code} after retries")
                log.warning("server error %s, retrying", resp.status_code)
                backoff_sleep(attempt)
                attempt += 1
                continue
            if resp.status_code != 200:
                # Includes the JSON "complexity too high" rejection (400).
                try:
                    body = resp.json()
                except Exception:
                    body = {"message": resp.text[:500]}
                message = str(body.get("message", body))
                if is_complexity_error(message):
                    raise ComplexityError(message)
                raise FatalQueryError(f"HTTP {resp.status_code}: {message}")
            try:
                return resp.json()
            except Exception as exc:
                if attempt >= 4:
                    raise StartGGError(f"invalid JSON response: {exc}") from exc
                backoff_sleep(attempt)
                attempt += 1

    def execute(self, spec: QuerySpec, variables: dict[str, Any]) -> dict:
        """Run a query, self-healing schema mismatches; returns the `data` dict."""
        heal_budget = 25
        while True:
            vars_in_use = {k: v for k, v in variables.items() if k in spec.variables}
            payload = self._post(spec.render(), vars_in_use)
            errors = payload.get("errors") or []
            if not errors:
                data = payload.get("data")
                if data is None:
                    raise FatalQueryError(f"{spec.name}: response had no data: {payload}")
                return data

            messages = [str(e.get("message", "")) for e in errors]
            joined = " | ".join(messages)
            if any(is_complexity_error(m) for m in messages):
                raise ComplexityError(joined)

            healed = False
            for message in messages:
                hit = classify_graphql_error(message)
                if not hit:
                    continue
                kind, name = hit
                ok = (
                    spec.drop_field(name)
                    if kind == "field"
                    else spec.drop_argument(name)
                    if kind == "argument"
                    else spec.drop_variable(name)
                )
                if ok:
                    healed = True
                    heal_budget -= 1
                    log.warning(
                        "query %s: dropping %s %r (API said: %s)", spec.name, kind, name, message
                    )
                    if self.on_fallback:
                        self.on_fallback(spec.name, kind, name, message)
            if healed and heal_budget > 0:
                continue

            # Partial-data tolerance: some deleted entities resolve to null
            # nodes with errors; accept data when present.
            data = payload.get("data")
            if data is not None:
                log.warning("query %s returned data with errors: %s", spec.name, joined[:300])
                return data
            raise FatalQueryError(f"{spec.name}: {joined[:1000]}")


class PageSizer:
    """Adaptive page size: shrink on complexity errors, slowly recover."""

    def __init__(self, default: int, minimum: int = 1):
        self.default = default
        self.minimum = minimum
        self.current = default
        self._successes = 0

    def shrink(self) -> int:
        self.current = max(self.minimum, self.current // 2)
        self._successes = 0
        return self.current

    def success(self) -> None:
        self._successes += 1
        if self._successes >= 30 and self.current < self.default:
            self.current = min(self.default, max(self.current + 1, int(self.current * 1.5)))
            self._successes = 0
