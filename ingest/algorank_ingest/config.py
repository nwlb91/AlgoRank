"""Configuration, sourced from environment variables (optionally a .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def load_dotenv(path: str | os.PathLike = ".env") -> None:
    """Tiny .env loader (no external dependency). Existing env vars win."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        os.environ.setdefault(key, value)


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass
class Config:
    database_url: str = ""
    startgg_token: str = ""
    parry_api_key: str = ""

    startgg_url: str = "https://api.start.gg/gql/alpha"
    parry_target: str = "api.parry.gg:443"

    # start.gg allows 80 requests / 60 s; stay safely under it.
    startgg_rpm: int = 70
    # parry.gg publishes no limit; be polite.
    parry_rps: float = 4.0

    # Melee's videogame id on start.gg (verified at runtime by name).
    melee_videogame_id: int = 1
    # Earliest tournament date to discover on start.gg (smash.gg launched 2015).
    backfill_start: str = "2014-06-01"

    # Default page sizes (auto-shrunk on complexity errors).
    per_page_discovery: int = 32
    per_page_sets: int = 16
    per_page_entrants: int = 50
    per_page_standings: int = 100
    per_page_seeds: int = 100
    per_page_phase_groups: int = 48

    # Split a discovery window when it reports more than this many tournaments
    # (the API cannot paginate past 10,000 objects).
    window_split_threshold: int = 6000
    min_window_hours: int = 6

    # Incremental sync: how far back to re-scan for late edits, and how far
    # ahead to pick up newly created tournaments.
    overlap_days: int = 45
    horizon_days: int = 400
    # An event is frozen ("final") this many days after the tournament ends.
    finalize_after_days: int = 60

    max_ingest_attempts: int = 5
    http_timeout: float = 60.0
    max_runtime_minutes: int = 0  # 0 = unlimited; >0 for chunked CI runs

    log_level: str = "INFO"

    dropped_fields: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "Config":
        load_dotenv()
        cfg = cls(
            database_url=os.environ.get("DATABASE_URL", ""),
            startgg_token=os.environ.get("STARTGG_API_TOKEN", ""),
            parry_api_key=os.environ.get("PARRY_API_KEY", ""),
        )
        cfg.startgg_url = os.environ.get("STARTGG_API_URL", cfg.startgg_url)
        cfg.parry_target = os.environ.get("PARRY_GRPC_TARGET", cfg.parry_target)
        cfg.startgg_rpm = _int("STARTGG_RPM", cfg.startgg_rpm)
        cfg.parry_rps = _float("PARRY_RPS", cfg.parry_rps)
        cfg.melee_videogame_id = _int("MELEE_VIDEOGAME_ID", cfg.melee_videogame_id)
        cfg.backfill_start = os.environ.get("BACKFILL_START", cfg.backfill_start)
        cfg.per_page_discovery = _int("PER_PAGE_DISCOVERY", cfg.per_page_discovery)
        cfg.per_page_sets = _int("PER_PAGE_SETS", cfg.per_page_sets)
        cfg.per_page_entrants = _int("PER_PAGE_ENTRANTS", cfg.per_page_entrants)
        cfg.per_page_standings = _int("PER_PAGE_STANDINGS", cfg.per_page_standings)
        cfg.per_page_seeds = _int("PER_PAGE_SEEDS", cfg.per_page_seeds)
        cfg.per_page_phase_groups = _int("PER_PAGE_PHASE_GROUPS", cfg.per_page_phase_groups)
        cfg.window_split_threshold = _int("WINDOW_SPLIT_THRESHOLD", cfg.window_split_threshold)
        cfg.overlap_days = _int("SYNC_OVERLAP_DAYS", cfg.overlap_days)
        cfg.horizon_days = _int("SYNC_HORIZON_DAYS", cfg.horizon_days)
        cfg.finalize_after_days = _int("FINALIZE_AFTER_DAYS", cfg.finalize_after_days)
        cfg.max_runtime_minutes = _int("MAX_RUNTIME_MINUTES", cfg.max_runtime_minutes)
        cfg.log_level = os.environ.get("LOG_LEVEL", cfg.log_level)
        return cfg
