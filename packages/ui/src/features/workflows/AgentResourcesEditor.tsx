import { Stack, TagsInput } from '@mantine/core';
import {
  resourceNamesSchema,
  resourceBindingsSchema,
  type ValueBinding,
} from '@interlock/core';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
const bindings = resourceBindingsSchema;
export function AgentResourcesEditor({
  value,
  onChange,
}: {
  value?: ValueBinding[];
  onChange: (value: ValueBinding[] | undefined) => void;
}) {
  const bound = value?.some(
    (b) => b.source !== 'literal' || typeof b.value !== 'string',
  );
  const names = (value ?? []).flatMap((b) =>
    b.source === 'literal' && typeof b.value === 'string' ? [b.value] : [],
  );
  const valid = names.length ? resourceNamesSchema.safeParse(names) : undefined;
  return (
    <Stack gap="sm" mb="md">
      {!bound && (
        <TagsInput
          label="Exclusive resources"
          description="Names are shared across this library. Coordinates Agent claims only; Script and Fetch nodes are not covered."
          placeholder="Add a resource name"
          value={names}
          acceptValueOnBlur
          maxTags={8}
          error={
            valid && !valid.success ? valid.error.issues[0]?.message : undefined
          }
          onChange={(names) =>
            onChange(
              names.length
                ? names.map((value) => ({ source: 'literal', value }))
                : undefined,
            )
          }
        />
      )}
      <details open={bound}>
        <summary>
          {bound ? 'Exclusive resource bindings' : 'Use values from the run'}
        </summary>
        <p className="hint">
          Use the existing input, runInput, rootInput, itemInput or node
          bindings. Each binding must resolve to a distinct resource name.
        </p>
        <JsonEditor
          label="Resource bindings"
          value={value ?? []}
          rows={5}
          validate={(value) =>
            bindings.safeParse(value).success
              ? undefined
              : 'Enter at most eight value bindings.'
          }
          onChange={(value) =>
            onChange(value.length ? bindings.parse(value) : undefined)
          }
        />
      </details>
    </Stack>
  );
}
