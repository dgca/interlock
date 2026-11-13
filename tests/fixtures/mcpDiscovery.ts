import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const definition = 'interlock://schemas/workflow-definition';
const shared: Record<string, [parameter: string, uri: string]> = {
  create_workflow: ['definition', definition],
  update_workflow: ['draft', definition],
  import_workflows: ['bundle', 'interlock://schemas/workflow-bundle'],
};

/**
 * Lists tools with the published schema resources their arguments reference
 * inlined, as an authoring agent sees them after reading those resources.
 */
export async function listToolsWithSharedSchemas(client: Client) {
  const discovery = await client.listTools();
  for (const tool of discovery.tools) {
    const reference = shared[tool.name];
    if (!reference) continue;
    const [parameter, uri] = reference;
    const { contents } = await client.readResource({ uri });
    const schema = JSON.parse((contents[0] as { text: string }).text) as Record<
      string,
      unknown
    >;
    delete schema.$schema;
    // Root references in the resource become references under the argument.
    const inlined = JSON.stringify(schema).replace(
      /"\$ref":"#(\/[^"]*)?"/g,
      (_match, path = '') => `"$ref":"#/properties/${parameter}${path}"`,
    );
    const properties = tool.inputSchema.properties!;
    properties[parameter] = {
      ...(JSON.parse(inlined) as Record<string, unknown>),
      description: (properties[parameter] as { description?: string })
        .description,
    };
  }
  return discovery;
}
