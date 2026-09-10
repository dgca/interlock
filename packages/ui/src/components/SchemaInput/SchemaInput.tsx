import { TextInput, Input, SegmentedControl } from '@mantine/core';
import type { Json } from '@interlock/core';
import { JsonEditor } from '../JsonEditor/JsonEditor';
/** Common object contracts get fields; complex values remain editable JSON. */
export function SchemaInput({
  schema,
  value,
  onChange,
}: {
  schema: Record<string, unknown>;
  value: Record<string, Json>;
  onChange: (value: Record<string, Json>) => void;
}) {
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return (
    <>
      {Object.entries(properties).map(([key, property]) => {
        const label = typeof property.title === 'string' ? property.title : key;
        const update = (next: Json) => onChange({ ...value, [key]: next });
        if (property.type === 'string')
          return (
            <TextInput
              mb="md"
              key={key}
              label={label}
              value={typeof value[key] === 'string' ? value[key] : ''}
              onChange={(e) => update(e.target.value)}
            />
          );
        if (property.type === 'number' || property.type === 'integer')
          return (
            <TextInput
              mb="md"
              key={key}
              label={label}
              type="number"
              step={property.type === 'integer' ? 1 : 'any'}
              value={typeof value[key] === 'number' ? value[key] : 0}
              onChange={(e) => update(Number(e.target.value))}
            />
          );
        if (property.type === 'boolean')
          return (
            <Input.Wrapper label={label} mb="md" key={key}>
              <SegmentedControl
                mt={4}
                style={{ display: 'flex', width: 'fit-content' }}
                aria-label={label}
                value={String(value[key] ?? false)}
                onChange={(next) => update(next === 'true')}
                data={[
                  { value: 'false', label: 'False' },
                  { value: 'true', label: 'True' },
                ]}
              />
            </Input.Wrapper>
          );
        return (
          <JsonEditor
            key={key}
            label={label}
            value={value[key] ?? null}
            onChange={update}
            rows={8}
          />
        );
      })}
    </>
  );
}
