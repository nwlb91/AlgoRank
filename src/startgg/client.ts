import Bottleneck from "bottleneck";
import { GraphQLClient, type Variables } from "graphql-request";
import { config, STARTGG_ENDPOINT } from "../config.js";
import { log } from "../log.js";

// start.gg's published limit is 80 req / 60s. We stay under that with headroom
// for retries.
//   reservoir = 70 tokens, refilled to 70 every 60s
//   minTime   = 800ms keeps us from bursting all 70 in the first second, which
//              the API has been observed to throttle even when within the
//              minute window.
const limiter = new Bottleneck({
  reservoir: 70,
  reservoirRefreshAmount: 70,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 4,
  minTime: 800,
});

const client = new GraphQLClient(STARTGG_ENDPOINT, {
  headers: { Authorization: `Bearer ${config.START_GG_TOKEN}` },
});

export class StartGgRateLimitError extends Error {
  constructor() {
    super("start.gg rate limit exceeded");
    this.name = "StartGgRateLimitError";
  }
}
export class StartGgComplexityError extends Error {
  readonly actual: number | null;
  constructor(message: string, actual: number | null) {
    super(message);
    this.name = "StartGgComplexityError";
    this.actual = actual;
  }
}

const COMPLEXITY_RE = /A maximum of 1000 objects.+actual:\s*(\d+)/i;

function classifyError(err: unknown): Error {
  // graphql-request throws ClientError with .response.errors and .response.status
  // start.gg also returns 200 with `{success:false, message:"..."}` style bodies
  // — graphql-request surfaces those via response.errors when the body has
  // `errors`, but the rate-limit / complexity cases come back as a top-level
  // object the library doesn't always parse as an error. We inspect both.
  const e = err as { message?: string; response?: { errors?: unknown[]; status?: number; data?: unknown } };
  const text = e.message ?? "";
  if (/Rate limit exceeded/i.test(text)) return new StartGgRateLimitError();
  const m = COMPLEXITY_RE.exec(text);
  if (m && m[1]) return new StartGgComplexityError(text, Number(m[1]));
  if (e.response?.status === 429) return new StartGgRateLimitError();
  return err instanceof Error ? err : new Error(String(err));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOpts {
  /** A short label used in logs and checkpoints. */
  opName: string;
  /** Max retry attempts on transient failures (default 5). */
  maxAttempts?: number;
}

export async function gql<TData, TVars extends Variables = Variables>(
  query: string,
  variables: TVars,
  opts: RequestOpts,
): Promise<TData> {
  const maxAttempts = opts.maxAttempts ?? 5;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const data = await limiter.schedule(() =>
        client.request<TData>(query, variables as Variables),
      );
      return data;
    } catch (raw) {
      const err = classifyError(raw);
      if (err instanceof StartGgComplexityError) {
        // Caller is responsible for shrinking page size on this. Surface it.
        throw err;
      }
      const isRateLimit = err instanceof StartGgRateLimitError;
      const isTransient =
        isRateLimit ||
        /ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up|network|5\d\d/i.test(
          err.message,
        );
      if (!isTransient || attempt >= maxAttempts) {
        log.error(
          { op: opName(opts), attempt, err: err.message },
          "start.gg request failed",
        );
        throw err;
      }
      const backoffMs = Math.min(60_000, 2 ** attempt * 1000);
      log.warn(
        { op: opName(opts), attempt, backoffMs, err: err.message },
        "start.gg request transient failure, retrying",
      );
      await sleep(backoffMs);
    }
  }
}

function opName(opts: RequestOpts): string {
  return opts.opName;
}
