import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { z } from 'zod';
import { definitionSchema } from '@interlock/core';

const definitionUri = 'interlock://schemas/workflow-definition';
const bundleUri = 'interlock://schemas/workflow-bundle';

// Discovery advertises a reference while validation still applies the complete
// schema: z.any() passes the value unchanged, so issues, paths and defaults
// match the inline schema these arguments used before.
function published<T extends z.ZodTypeAny>(schema: T, description: string) {
  return z.any().pipe(schema).describe(description);
}

export const sharedDefinitionSchema = published(
  definitionSchema,
  `Workflow definition JSON object. Read the MCP resource ${definitionUri} for its complete JSON Schema, or start from get_workflow or export_workflow output. validate_workflow reports located diagnostics without saving.`,
);

// Core's bundle schema is passed in by the server module, which owns that import.
export function sharedBundle<T extends z.ZodTypeAny>(bundleSchema: T) {
  return published(
    bundleSchema,
    `Workflow bundle JSON object, normally an unmodified export_workflow result. Read the MCP resource ${bundleUri} for its complete JSON Schema; definitions inside it follow ${definitionUri}.`,
  );
}

/** Serve each large shared schema once instead of repeating it per tool. */
export function publishSchemaResources(
  server: McpServer,
  bundleSchema: z.ZodTypeAny,
) {
  for (const [name, uri, schema, description] of [
    [
      'workflow-definition-schema',
      definitionUri,
      definitionSchema,
      'JSON Schema for workflow definitions accepted by create_workflow, update_workflow and validate_workflow.',
    ],
    [
      'workflow-bundle-schema',
      bundleUri,
      bundleSchema,
      'JSON Schema for import_workflows bundles.',
    ],
  ] as const)
    server.registerResource(
      name,
      uri,
      { mimeType: 'application/schema+json', description },
      () => ({
        contents: [
          {
            uri,
            mimeType: 'application/schema+json',
            text: JSON.stringify(
              toJsonSchemaCompat(schema, {
                strictUnions: true,
                pipeStrategy: 'input',
              }),
            ),
          },
        ],
      }),
    );
}
