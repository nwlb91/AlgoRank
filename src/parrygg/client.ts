// parry.gg gRPC-Web client wrapper. Mirrors the role of src/startgg/client.ts:
// rate limiting, retry with backoff, distinct error classes, and a single
// place where the API key is attached.
//
// @parry-gg/client targets gRPC-Web (browser-shaped), so in Node we have to
// install an XMLHttpRequest polyfill before any service client is constructed.
// We do that at module load time.

import xhr from "xhr2";
if (typeof globalThis.XMLHttpRequest === "undefined") {
  (globalThis as unknown as { XMLHttpRequest: typeof xhr }).XMLHttpRequest = xhr;
}

import Bottleneck from "bottleneck";
import { StatusCode, type RpcError, type Metadata } from "grpc-web";
import {
  TournamentServiceClient,
  GameServiceClient,
  EventServiceClient,
  MatchServiceClient,
  BracketServiceClient,
  PhaseServiceClient,
  HierarchyServiceClient,
  UserServiceClient,
} from "@parry-gg/client";
import { config, PARRYGG_GRPCWEB_ENDPOINT } from "../config.js";
import { log } from "../log.js";

// parry.gg has not published a documented rate limit (the docs we could reach
// only say it's "generally higher than start.gg"). We start conservatively at
// ~60 req/min with low concurrency; tune upward once we observe how the API
// actually responds.
const limiter = new Bottleneck({
  reservoir: 60,
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 4,
  minTime: 200,
});

function requireToken(): string {
  if (!config.PARRY_GG_TOKEN) {
    throw new Error(
      "PARRY_GG_TOKEN is not set. Add it to .env (see .env.example). " +
        "Create a key at https://parry.gg.",
    );
  }
  return config.PARRY_GG_TOKEN;
}

function authMetadata(): Metadata {
  return { "X-API-KEY": requireToken() };
}

// Service-client singletons. Lazy so importing this module never trips the
// PARRY_GG_TOKEN check (the token is only consumed when an RPC is actually
// fired). Each client opens its own grpc-web transport, but they share the
// same hostname and the shared rate limiter below.
let tournamentClient: TournamentServiceClient | null = null;
let gameClient: GameServiceClient | null = null;
let eventClient: EventServiceClient | null = null;
let matchClient: MatchServiceClient | null = null;
let bracketClient: BracketServiceClient | null = null;
let phaseClient: PhaseServiceClient | null = null;
let hierarchyClient: HierarchyServiceClient | null = null;
let userClient: UserServiceClient | null = null;

export function tournaments(): TournamentServiceClient {
  return (tournamentClient ??= new TournamentServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function games(): GameServiceClient {
  return (gameClient ??= new GameServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function events(): EventServiceClient {
  return (eventClient ??= new EventServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function matches(): MatchServiceClient {
  return (matchClient ??= new MatchServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function brackets(): BracketServiceClient {
  return (bracketClient ??= new BracketServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function phases(): PhaseServiceClient {
  return (phaseClient ??= new PhaseServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function hierarchy(): HierarchyServiceClient {
  return (hierarchyClient ??= new HierarchyServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}
export function users(): UserServiceClient {
  return (userClient ??= new UserServiceClient(PARRYGG_GRPCWEB_ENDPOINT));
}

// ---------------------------------------------------------------------------
// Errors. gRPC surfaces failures via status codes; we keep a small hierarchy
// so callers can branch on intent without re-parsing strings.
// ---------------------------------------------------------------------------

export class ParryGgError extends Error {
  readonly code: StatusCode | undefined;
  constructor(message: string, code?: StatusCode) {
    super(message);
    this.name = "ParryGgError";
    this.code = code;
  }
}
export class ParryGgUnauthenticatedError extends ParryGgError {
  constructor(message: string) {
    super(message, StatusCode.UNAUTHENTICATED);
    this.name = "ParryGgUnauthenticatedError";
  }
}
export class ParryGgRateLimitError extends ParryGgError {
  constructor(message: string) {
    super(message, StatusCode.RESOURCE_EXHAUSTED);
    this.name = "ParryGgRateLimitError";
  }
}
export class ParryGgUnavailableError extends ParryGgError {
  constructor(message: string) {
    super(message, StatusCode.UNAVAILABLE);
    this.name = "ParryGgUnavailableError";
  }
}
export class ParryGgNotFoundError extends ParryGgError {
  constructor(message: string) {
    super(message, StatusCode.NOT_FOUND);
    this.name = "ParryGgNotFoundError";
  }
}

function classifyError(err: unknown): Error {
  const e = err as Partial<RpcError> & { message?: string };
  const msg = e.message ?? String(err);
  switch (e.code) {
    case StatusCode.UNAUTHENTICATED:
      return new ParryGgUnauthenticatedError(msg);
    case StatusCode.RESOURCE_EXHAUSTED:
      return new ParryGgRateLimitError(msg);
    case StatusCode.UNAVAILABLE:
      return new ParryGgUnavailableError(msg);
    case StatusCode.NOT_FOUND:
      return new ParryGgNotFoundError(msg);
    default:
      return new ParryGgError(msg, e.code);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RpcOpts {
  /** Short label included in retry logs. */
  opName: string;
  /** Max retry attempts on transient failures (default 5). */
  maxAttempts?: number;
}

/**
 * Execute a gRPC-Web call under the shared rate limiter, with exponential
 * backoff on transient failures. `op` is the bound service method — caller
 * passes `(req, meta) => client.getTournaments(req, meta)` etc.
 */
export async function call<Req, Resp>(
  op: (req: Req, meta: Metadata) => Promise<Resp>,
  req: Req,
  opts: RpcOpts,
): Promise<Resp> {
  const maxAttempts = opts.maxAttempts ?? 5;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const meta = authMetadata();
      return await limiter.schedule(() => op(req, meta));
    } catch (raw) {
      const err = classifyError(raw);
      // Unauthenticated and NotFound are terminal; surface immediately.
      if (
        err instanceof ParryGgUnauthenticatedError ||
        err instanceof ParryGgNotFoundError
      ) {
        log.error({ op: opts.opName, attempt, err: err.message }, "parry.gg request failed (terminal)");
        throw err;
      }
      const isTransient =
        err instanceof ParryGgRateLimitError ||
        err instanceof ParryGgUnavailableError ||
        /ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up|network|terminated|5\d\d/i.test(
          err.message,
        );
      if (!isTransient || attempt >= maxAttempts) {
        log.error({ op: opts.opName, attempt, err: err.message, code: (err as ParryGgError).code }, "parry.gg request failed");
        throw err;
      }
      const backoffMs = Math.min(60_000, 2 ** attempt * 1000);
      log.warn(
        { op: opts.opName, attempt, backoffMs, err: err.message, code: (err as ParryGgError).code },
        "parry.gg request transient failure, retrying",
      );
      await sleep(backoffMs);
    }
  }
}
