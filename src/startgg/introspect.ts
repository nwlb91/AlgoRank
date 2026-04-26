import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getIntrospectionQuery, buildClientSchema, printSchema, type IntrospectionQuery } from "graphql";
import { gql } from "./client.js";
import { log } from "../log.js";

const SCHEMA_JSON_PATH = "schema/startgg.json";
const SCHEMA_SDL_PATH = "schema/startgg.graphql";

export async function introspectAndWrite(): Promise<{ jsonPath: string; sdlPath: string }> {
  log.info({ endpoint: "https://api.start.gg/gql/alpha" }, "running introspection");
  // Note: schemaDescription is intentionally omitted. start.gg's server does
  // not implement the `__schema.description` field (a newer spec addition)
  // and rejects the standard introspection query if it's requested.
  const query = getIntrospectionQuery({ descriptions: true });
  const data = await gql<IntrospectionQuery>(query, {}, { opName: "introspection" });

  for (const path of [SCHEMA_JSON_PATH, SCHEMA_SDL_PATH]) {
    mkdirSync(dirname(path), { recursive: true });
  }

  writeFileSync(SCHEMA_JSON_PATH, JSON.stringify(data, null, 2));
  const sdl = printSchema(buildClientSchema(data));
  writeFileSync(SCHEMA_SDL_PATH, sdl);

  log.info(
    { jsonPath: SCHEMA_JSON_PATH, sdlPath: SCHEMA_SDL_PATH, bytes: sdl.length },
    "wrote schema",
  );
  return { jsonPath: SCHEMA_JSON_PATH, sdlPath: SCHEMA_SDL_PATH };
}
