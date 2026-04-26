import { readFileSync, existsSync } from "node:fs";
import {
  buildClientSchema,
  type GraphQLSchema,
  type GraphQLObjectType,
  type GraphQLField,
  type IntrospectionQuery,
  isObjectType,
  isScalarType,
  isEnumType,
  isNonNullType,
  isListType,
  type GraphQLOutputType,
} from "graphql";

const SCHEMA_JSON_PATH = "schema/startgg.json";

let cachedSchema: GraphQLSchema | null = null;

export function loadSchema(path = SCHEMA_JSON_PATH): GraphQLSchema {
  if (cachedSchema) return cachedSchema;
  if (!existsSync(path)) {
    throw new Error(
      `Schema introspection result not found at ${path}. ` +
        `Run \`algorank introspect\` first.`,
    );
  }
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as IntrospectionQuery;
  cachedSchema = buildClientSchema(data);
  return cachedSchema;
}

function unwrap(t: GraphQLOutputType): GraphQLOutputType {
  let cur = t;
  while (isNonNullType(cur) || isListType(cur)) cur = cur.ofType as GraphQLOutputType;
  return cur;
}

/**
 * Returns the list of scalar/enum field names on a given object type, with no
 * arguments. (Fields that take required arguments are skipped — they need
 * dedicated handling.) The result is sorted for stable query strings.
 */
export function scalarFieldsOf(typeName: string): string[] {
  const schema = loadSchema();
  const t = schema.getType(typeName);
  if (!t || !isObjectType(t)) {
    throw new Error(`Type ${typeName} is not an object type in the schema`);
  }
  const obj = t as GraphQLObjectType;
  const fields = obj.getFields();
  const out: string[] = [];
  for (const name of Object.keys(fields)) {
    const f = fields[name] as GraphQLField<unknown, unknown>;
    const requiresArgs = f.args.some((a) => isNonNullType(a.type) && a.defaultValue === undefined);
    if (requiresArgs) continue;
    const inner = unwrap(f.type);
    if (isScalarType(inner) || isEnumType(inner)) {
      out.push(name);
    }
  }
  return out.sort();
}

/** Renders a selection-set body (no braces) of all scalar fields on `typeName`. */
export function selectScalars(typeName: string, indent = "    "): string {
  return scalarFieldsOf(typeName)
    .map((f) => `${indent}${f}`)
    .join("\n");
}

/**
 * Verifies that the named type exists and has the named field. Throws with a
 * clear message if not. Used as a sanity check before constructing queries
 * that reference specific fields.
 */
export function requireField(typeName: string, fieldName: string): void {
  const schema = loadSchema();
  const t = schema.getType(typeName);
  if (!t || !isObjectType(t)) {
    throw new Error(`Type ${typeName} is not an object type in the schema`);
  }
  const fields = (t as GraphQLObjectType).getFields();
  if (!fields[fieldName]) {
    throw new Error(
      `Field ${typeName}.${fieldName} does not exist in the introspected schema. ` +
        `If start.gg removed it, the ingester needs to be updated.`,
    );
  }
}

/**
 * Returns the unwrapped object type name produced by `parentType.fieldName`.
 * Lets us render scalar selections for nested objects without hardcoding the
 * exact type name (e.g. `Set.slots` may be `[SetSlot]` or `[Slot]`).
 */
export function resolveFieldTypeName(parentType: string, fieldName: string): string {
  const schema = loadSchema();
  const t = schema.getType(parentType);
  if (!t || !isObjectType(t)) {
    throw new Error(`Type ${parentType} is not an object type in the schema`);
  }
  const f = (t as GraphQLObjectType).getFields()[fieldName];
  if (!f) {
    throw new Error(`Field ${parentType}.${fieldName} does not exist in the schema`);
  }
  const inner = unwrap(f.type);
  if (!isObjectType(inner)) {
    throw new Error(
      `Field ${parentType}.${fieldName} does not resolve to an object type (got ${String(inner)})`,
    );
  }
  return (inner as GraphQLObjectType).name;
}
