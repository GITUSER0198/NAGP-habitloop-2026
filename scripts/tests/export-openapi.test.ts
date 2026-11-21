// Merging must preserve distinct service schemas and authentication references.
import { describe, expect, it } from 'vitest';
import { type OpenApiDocument, merge } from '../export-openapi.js';

function document(route: string, valueType: string): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: { title: route, version: '1' },
    paths: {
      [route]: {
        get: {
          operationId: 'get_item',
          security: [{ HTTPBearer: [] }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } },
        },
      },
    },
    components: {
      schemas: { Item: { type: valueType } },
      securitySchemes: { HTTPBearer: { type: 'http', scheme: 'bearer' } },
    },
  };
}

describe('merge', () => {
  it('namespaces colliding names without mutating the sources', () => {
    const documents = {
      'user-service': document('/api/users/me', 'string'),
      'activity-service': document('/api/activities', 'integer'),
    };
    const before = JSON.stringify(documents);
    const merged = merge(documents, 'https://example.com/');
    const components = merged.components as Record<string, Record<string, { type?: string }>>;
    expect(components.schemas.user_service__Item.type).toBe('string');
    expect(components.schemas.activity_service__Item.type).toBe('integer');
    expect(Object.keys(components.securitySchemes)).toEqual(['user_service__HTTPBearer', 'activity_service__HTTPBearer']);
    const paths = merged.paths as Record<string, { get: { security: unknown; operationId: string; responses: Record<string, { content: Record<string, { schema: { $ref: string } }> }> } }>;
    const operation = paths['/api/users/me'].get;
    expect(operation.security).toEqual([{ user_service__HTTPBearer: [] }]);
    expect(operation.operationId).toBe('user_service__get_item');
    expect(operation.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/user_service__Item');
    expect(merged.servers).toEqual([{ url: 'https://example.com' }]);
    expect(JSON.stringify(documents)).toBe(before);
  });

  it('rejects duplicate paths', () => {
    expect(() => merge({ one: document('/same', 'string'), two: document('/same', 'integer') }, '/')).toThrow('Duplicate API path');
  });

  it('rejects mixed OpenAPI versions', () => {
    const other = { ...document('/b', 'string'), openapi: '3.0.0' };
    expect(() => merge({ one: document('/a', 'string'), two: other }, '/')).toThrow('different OpenAPI versions');
  });
});
