"""gRPC client wrapper for the parry.gg API.

parry.gg exposes gRPC services at api.parry.gg:443, authenticated with an
``x-api-key`` metadata entry. The official ``parrygg`` package provides the
generated stubs. Every response message is converted to a plain dict
(preserving proto field names) so raw payloads can be stored as JSONB.
"""

from __future__ import annotations

import logging
import time

import grpc
from google.protobuf.json_format import MessageToDict

from ..util import backoff_sleep

log = logging.getLogger("algorank.parry")

RETRYABLE = {
    grpc.StatusCode.UNAVAILABLE,
    grpc.StatusCode.RESOURCE_EXHAUSTED,
    grpc.StatusCode.DEADLINE_EXCEEDED,
    grpc.StatusCode.INTERNAL,
}


def to_dict(message) -> dict:
    """Proto -> dict including zero-valued fields (slot 0, score 0.0, ...).

    protobuf 4.x calls the flag including_default_value_fields; 5.x renamed it
    to always_print_fields_with_no_presence.
    """
    try:
        return MessageToDict(
            message,
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=True,
        )
    except TypeError:
        return MessageToDict(
            message,
            preserving_proto_field_name=True,
            including_default_value_fields=True,
        )


class ParryClient:
    def __init__(self, target: str, api_key: str, rps: float = 4.0, timeout: float = 60.0):
        self.target = target
        self.metadata = [("x-api-key", api_key)]
        self.min_interval = 1.0 / max(rps, 0.1)
        self.timeout = timeout
        self.channel = grpc.secure_channel(target, grpc.ssl_channel_credentials())
        self._last_call = 0.0
        self.request_count = 0

        from parrygg.services.tournament_service_pb2_grpc import TournamentServiceStub
        from parrygg.services.event_service_pb2_grpc import EventServiceStub
        from parrygg.services.phase_service_pb2_grpc import PhaseServiceStub
        from parrygg.services.bracket_service_pb2_grpc import BracketServiceStub
        from parrygg.services.entrant_service_pb2_grpc import EntrantServiceStub
        from parrygg.services.user_service_pb2_grpc import UserServiceStub
        from parrygg.services.game_service_pb2_grpc import GameServiceStub
        from parrygg.services.stream_service_pb2_grpc import StreamServiceStub
        from parrygg.services.match_service_pb2_grpc import MatchServiceStub

        self.tournaments = TournamentServiceStub(self.channel)
        self.events = EventServiceStub(self.channel)
        self.phases = PhaseServiceStub(self.channel)
        self.brackets = BracketServiceStub(self.channel)
        self.entrants = EntrantServiceStub(self.channel)
        self.users = UserServiceStub(self.channel)
        self.games = GameServiceStub(self.channel)
        self.streams = StreamServiceStub(self.channel)
        self.matches = MatchServiceStub(self.channel)

    def call(self, method, request, retries: int = 8):
        """Rate-limited, retrying unary call. Returns the response message."""
        attempt = 0
        while True:
            wait = self._last_call + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_call = time.monotonic()
            self.request_count += 1
            try:
                return method(request, metadata=self.metadata, timeout=self.timeout)
            except grpc.RpcError as exc:
                code = exc.code() if hasattr(exc, "code") else None
                if code in RETRYABLE and attempt < retries:
                    log.warning("parry rpc %s, retrying (%d)", code, attempt)
                    backoff_sleep(attempt)
                    attempt += 1
                    continue
                raise

    def close(self) -> None:
        self.channel.close()
