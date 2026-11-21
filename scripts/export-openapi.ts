// Export service OpenAPI documents through the gateway and namespace their merge.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SERVICES: Record<string, string> = {
  'user-service': 'users',
  'activity-service': 'activities',
  'challenge-service': 'challenges',
  'integration-service': 'integrations',
  'analytics-service': 'analytics',
  'recommendation-service': 'recommendations',
};

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
export type OpenApiDocument = JsonObject & { openapi: string; paths: JsonObject; components?: JsonObject };

const isObject = (value: Json): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Prefix component references, security scheme names and operation ids so merged services cannot collide. */
export function namespace(value: Json, prefix: string): Json {
  if (Array.isArray(value)) return value.map((item) => namespace(item, prefix));
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string' && item.startsWith('#/components/')) {
      const parts = item.split('/');
      parts[3] = prefix + parts[3];
      result[key] = parts.join('/');
    } else if (key === 'security' && Array.isArray(item)) {
      result[key] = item.map((requirement) => Object.fromEntries(
        Object.entries(requirement as JsonObject).map(([name, scopes]) => [prefix + name, scopes]),
      ));
    } else if (key === 'operationId' && typeof item === 'string') {
      result[key] = prefix + item;
    } else if (key === 'mapping' && isObject(item)) {
      result[key] = Object.fromEntries(Object.entries(item).map(([name, ref]) => [
        name, (namespace({ $ref: ref }, prefix) as JsonObject).$ref,
      ]));
    } else {
      result[key] = namespace(item, prefix);
    }
  }
  return result;
}

export function merge(documents: Record<string, OpenApiDocument>, baseUrl: string): JsonObject {
  const first = Object.values(documents)[0];
  const merged: JsonObject & { paths: JsonObject; components: JsonObject } = {
    openapi: first.openapi,
    info: { title: 'HabitLoop API', version: '1.0.0' },
    servers: [{ url: baseUrl.replace(/\/+$/, '') }],
    paths: {},
    components: {},
  };
  for (const [service, original] of Object.entries(documents)) {
    if (original.openapi !== merged.openapi) throw new Error('Cannot merge different OpenAPI versions');
    const prefix = `${service.replaceAll('-', '_')}__`;
    // structuredClone-equivalent: namespace() already builds new objects, so sources stay untouched.
    const document = namespace(original, prefix) as OpenApiDocument;
    for (const [route, operations] of Object.entries(document.paths)) {
      if (route in merged.paths) throw new Error(`Duplicate API path: ${route}`);
      merged.paths[route] = operations;
    }
    for (const [section, entries] of Object.entries(document.components ?? {})) {
      const target = (merged.components[section] ??= {}) as JsonObject;
      for (const [name, entry] of Object.entries(entries as JsonObject)) target[prefix + name] = entry;
    }
  }
  return merged;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { 'base-url': { type: 'string', default: process.env.BASE_URL ?? 'http://localhost:47810' } },
  });
  const baseUrl = values['base-url'] as string;
  const output = path.join(ROOT, 'docs', 'api');
  try {
    const documents: Record<string, OpenApiDocument> = {};
    let index = 0;
    for (const [service, route] of Object.entries(SERVICES)) {
      index += 1;
      console.log(`${index} of ${Object.keys(SERVICES).length}: fetching ${service}`);
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/${route}/openapi.json`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      documents[service] = (await response.json()) as OpenApiDocument;
    }
    const combined = merge(documents, baseUrl);
    mkdirSync(output, { recursive: true });
    for (const [service, document] of Object.entries({ ...documents, habitloop: combined })) {
      writeFileSync(path.join(output, `${service}.openapi.json`), `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    }
    console.log('PASS: six service specifications and merged HabitLoop specification exported');
  } catch (error) {
    console.error(`FAIL: OpenAPI export: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
