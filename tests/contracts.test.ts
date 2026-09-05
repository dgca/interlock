import { describe, expect, it } from 'vitest';
import {
  assertContract,
  contractExample,
  inferContract,
  renameField,
  validateContractSchema,
  visualIssues,
} from '@interlock/core';

describe('contract editing', () => {
  it('infers nested research fields and validates an actual result against them', () => {
    const result = {
      protocol: 'Foo',
      sources: [{ title: 'Docs', url: 'https://example.com' }],
      unknowns: [],
      active: true,
    };
    const { schema, notes } = inferContract(result);
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: { type: 'object', required: ['title', 'url'] },
        },
        unknowns: { type: 'array', items: {} },
      },
    });
    expect(notes.some((n) => n.includes('empty list'))).toBe(true);
    expect(notes.some((n) => n.includes('required'))).toBe(true);
    expect(() => assertContract(schema, result, 'Research')).not.toThrow();
    expect(visualIssues(schema)).toEqual([]);
  });
  it('combines all list examples and marks intermittently absent fields optional', () => {
    const { schema } = inferContract([
      { name: 'A', website: 'https://a.example' },
      { name: 'B', active: true },
    ]);
    expect(schema).toMatchObject({
      items: {
        required: ['name'],
        properties: {
          name: { type: 'string' },
          website: { type: 'string' },
          active: { type: 'boolean' },
        },
      },
    });
    expect(() =>
      assertContract(schema, [{ name: 'C' }], 'Protocols'),
    ).not.toThrow();
  });
  it('preserves mixed types as alternatives and routes them to advanced editing', () => {
    const { schema, notes } = inferContract([null, 'known', 42]);
    expect(schema).toEqual({
      type: 'array',
      items: {
        anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'integer' }],
      },
    });
    expect(visualIssues(schema).some((i) => i.includes('anyOf'))).toBe(true);
    expect(notes.some((n) => n.includes('mixed types'))).toBe(true);
    expect(() =>
      assertContract(schema, [null, 'unknown', 10], 'Mixed'),
    ).not.toThrow();
  });
  it('does not guess non-null types from null', () => {
    const { schema, notes } = inferContract({ engagement: null });
    expect(schema).toMatchObject({
      properties: { engagement: { type: 'null' } },
    });
    expect(notes.some((n) => n.includes('null does not reveal'))).toBe(true);
  });
  it('detects unsupported keywords at every nesting level without mutating a schema', () => {
    const schema = {
      $defs: { source: { type: 'string' } },
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: '#/$defs/source' } },
      },
      additionalProperties: { type: 'number' },
    };
    const original = structuredClone(schema);
    const issues = visualIssues(schema);
    expect(issues.some((i) => i.includes('$defs'))).toBe(true);
    expect(issues.some((i) => i.includes('$ref'))).toBe(true);
    expect(issues.some((i) => i.includes('additional-property'))).toBe(true);
    expect(schema).toEqual(original);
  });
  it('renames keys explicitly and preserves titles, constraints, and required membership', () => {
    const schema = {
      type: 'object',
      properties: {
        protocol: {
          type: 'string',
          title: 'Protocol name',
          description: 'Name',
          minLength: 1,
        },
        other: { type: 'boolean' },
      },
      required: ['protocol'],
      additionalProperties: false,
    };
    const renamed = renameField(schema, 'protocol', 'protocolName');
    expect(renamed).toEqual({
      ...schema,
      properties: {
        protocolName: schema.properties.protocol,
        other: schema.properties.other,
      },
      required: ['protocolName'],
    });
    expect(schema.required).toEqual(['protocol']);
    expect(() => renameField(schema, 'protocol', 'other')).toThrow(
      'already exists',
    );
    expect(() => renameField(schema, 'protocol', '')).toThrow('empty');
  });
  it('generates an example with stable keys and explicit unknown choices', () => {
    const schema = {
      type: 'object',
      properties: {
        engagementStatus: {
          type: 'string',
          title: 'Engagement status',
          enum: ['unknown', 'active'],
        },
        sources: {
          type: 'array',
          items: { type: 'object', properties: { url: { type: 'string' } } },
        },
      },
      required: ['engagementStatus'],
    };
    expect(contractExample(schema)).toEqual({
      engagementStatus: 'unknown',
      sources: [{ url: 'Example text' }],
    });
    expect(() =>
      assertContract(schema, contractExample(schema) as any, 'Example'),
    ).not.toThrow();
  });
  it('reports the field, expected kind, and received value', () => {
    expect(() =>
      assertContract(
        { type: 'object', properties: { sources: { type: 'array' } } },
        { sources: 'https://example.com' },
        'Research output',
      ),
    ).toThrow('"sources" expects a list; received text: "https://example.com"');
    expect(() =>
      assertContract(
        { type: 'object', required: ['findings'] },
        {},
        'Research output',
      ),
    ).toThrow('Missing required field "findings"');
  });
  it('rejects invalid schemas and keeps complex schemas valid', () => {
    expect(() => validateContractSchema({ type: 'banana' })).toThrow();
    expect(() =>
      validateContractSchema({
        type: 'object',
        properties: {
          choice: { anyOf: [{ type: 'null' }, { type: 'string' }] },
        },
      }),
    ).not.toThrow();
  });
});
