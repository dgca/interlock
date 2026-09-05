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
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                value={typeof value[key] === 'string' ? value[key] : ''}
                onChange={(e) => update(e.target.value)}
              />
            </label>
          );
        if (property.type === 'number' || property.type === 'integer')
          return (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                step={property.type === 'integer' ? 1 : 'any'}
                value={typeof value[key] === 'number' ? value[key] : 0}
                onChange={(e) => update(Number(e.target.value))}
              />
            </label>
          );
        if (property.type === 'boolean')
          return (
            <label className="field" key={key}>
              <span>{label}</span>
              <select
                value={String(value[key] ?? false)}
                onChange={(e) => update(e.target.value === 'true')}
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>
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
