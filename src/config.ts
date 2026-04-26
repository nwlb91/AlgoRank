import "dotenv/config";
import { z } from "zod";

const Schema = z.object({
  START_GG_TOKEN: z.string().min(1, "START_GG_TOKEN is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export const config = (() => {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Missing or invalid environment configuration:\n  ${msg}\n` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
})();

export const STARTGG_ENDPOINT = "https://api.start.gg/gql/alpha";
export const MELEE_VIDEOGAME_ID = 1;

export const Source = {
  STARTGG: "STARTGG",
  MANUAL: "MANUAL",
} as const;
export type Source = (typeof Source)[keyof typeof Source];

export function externalKey(source: string, sourceId: string | number): string {
  return `${source}:${String(sourceId)}`;
}
