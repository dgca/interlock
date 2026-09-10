import { Checkbox, NativeSelect, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  fieldType,
  fieldTypes,
  newContract,
  propertiesOf,
  requiredOf,
  renameField,
  type Contract,
  type FieldType,
} from '@interlock/core';
import { Button } from '../Button/Button';
import styles from './ContractEditor.module.css';

export function FieldEditor({
  schema,
  onChange,
  path = 'Value',
  depth = 0,
}: {
  schema: Contract;
  onChange: (schema: Contract) => void;
  path?: string;
  depth?: number;
}) {
  const type = fieldType(schema);
  const patch = (updates: Contract) => onChange({ ...schema, ...updates });
  return (
    <div className={styles.definition}>
      <NativeSelect
        mb="md"
        label={depth ? 'Value type' : 'Structure'}
        aria-label={`${path} type`}
        value={type}
        onChange={(e) =>
          onChange({
            ...newContract(e.target.value as FieldType),
            ...(schema.title !== undefined ? { title: schema.title } : {}),
            ...(schema.description !== undefined
              ? { description: schema.description }
              : {}),
          })
        }
      >
        {(depth
          ? [
              'string',
              'object',
              'array',
              'choice',
              'number',
              'integer',
              'boolean',
              'any',
              'null',
            ]
          : [
              'any',
              'object',
              'array',
              'string',
              'choice',
              'number',
              'integer',
              'boolean',
              'null',
            ]
        ).map((value) => (
          <option key={value} value={value}>
            {fieldTypes[value as FieldType]}
          </option>
        ))}
      </NativeSelect>

      {type === 'any' && (
        <p className="hint">
          Accepts any value. Choose Object to define named fields.
        </p>
      )}
      {type === 'null' && (
        <p className="hint">
          Accepts only null. To express uncertainty in text, use a Choice with
          an “unknown” option.
        </p>
      )}
      {type === 'choice' && (
        <Choices schema={schema} onChange={onChange} path={path} />
      )}
      {type === 'object' && (
        <ObjectFields
          schema={schema}
          onChange={onChange}
          path={path}
          depth={depth}
        />
      )}
      {type === 'array' && (
        <div className={styles.nested}>
          <h4>Each item</h4>
          {depth < 12 ? (
            <FieldEditor
              schema={(schema.items ?? {}) as Contract}
              onChange={(items) => patch({ items })}
              path={`${path} items`}
              depth={depth + 1}
            />
          ) : (
            <p className="hint">Use advanced JSON for deeper nesting.</p>
          )}
        </div>
      )}
      <details className={styles.constraints}>
        <summary>Description and constraints</summary>

        <Textarea
          mb="md"
          label="Description for the agent"
          rows={2}
          value={String(schema.description ?? '')}
          onChange={(e) => patch({ description: e.target.value })}
        />

        {(type === 'string' || type === 'choice') && (
          <Bounds
            schema={schema}
            onChange={onChange}
            min="minLength"
            max="maxLength"
            label="Text length"
            integer
          />
        )}
        {(type === 'number' || type === 'integer') && (
          <Bounds
            schema={schema}
            onChange={onChange}
            min="minimum"
            max="maximum"
            label="Number"
            integer={type === 'integer'}
          />
        )}
        {type === 'array' && (
          <Bounds
            schema={schema}
            onChange={onChange}
            min="minItems"
            max="maxItems"
            label="List length"
            integer
          />
        )}
        {type === 'object' && (
          <Checkbox
            my="md"
            label="Allow additional fields"
            checked={schema.additionalProperties !== false}
            onChange={(e) => patch({ additionalProperties: e.target.checked })}
          />
        )}
        <p className="hint">
          Changing a type resets its fields and constraints. Display names can
          change without changing data keys.
        </p>
      </details>
    </div>
  );
}
function ObjectFields({
  schema,
  onChange,
  path,
  depth,
}: {
  schema: Contract;
  onChange: (s: Contract) => void;
  path: string;
  depth: number;
}) {
  const fields = propertiesOf(schema),
    required = requiredOf(schema);
  const replace = (key: string, field: Contract) =>
    onChange({ ...schema, properties: { ...fields, [key]: field } });
  return (
    <div className={styles.fields}>
      {Object.entries(fields).map(([key, field]) => (
        <details key={key} className={styles.field}>
          <summary>
            <strong>{String(field.title || key)}</strong>
            <code>{key}</code>
            <span>
              {fieldTypes[fieldType(field)]}
              {required.includes(key) ? ' · required' : ''}
            </span>
          </summary>
          <div className={styles.fieldBody}>
            <TextInput
              mb="md"
              label="Display name"
              aria-label={`${path}.${key} display name`}
              value={String(field.title ?? '')}
              placeholder={key}
              onChange={(e) =>
                replace(key, { ...field, title: e.target.value })
              }
            />

            <DataKey
              value={key}
              onChange={(next) => onChange(renameField(schema, key, next))}
            />
            <Checkbox
              my="md"
              label="Required field"
              aria-label={`${path}.${key} required`}
              checked={required.includes(key)}
              onChange={(e) =>
                onChange({
                  ...schema,
                  required: e.target.checked
                    ? [...required, key]
                    : required.filter((k) => k !== key),
                })
              }
            />
            {depth < 12 && (
              <FieldEditor
                schema={field}
                onChange={(next) => replace(key, next)}
                path={`${path}.${key}`}
                depth={depth + 1}
              />
            )}
            <Button
              variant="ghost"
              onClick={() =>
                onChange({
                  ...schema,
                  properties: Object.fromEntries(
                    Object.entries(fields).filter(([k]) => k !== key),
                  ),
                  ...(schema.required
                    ? { required: required.filter((k) => k !== key) }
                    : {}),
                })
              }
            >
              <Trash2 />
              Remove field
            </Button>
          </div>
        </details>
      ))}
      <Button
        onClick={() => {
          let index = 1;
          while (Object.hasOwn(fields, `field${index}`)) index++;
          const key = `field${index}`;
          onChange({
            ...schema,
            properties: { ...fields, [key]: { type: 'string' } },
            required: [...required, key],
          });
        }}
      >
        <Plus />
        Add field
      </Button>
    </div>
  );
}
function DataKey({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('');
  return (
    <TextInput
      mb="md"
      error={error || undefined}
      description="Used in the JSON data. Renaming this key can affect downstream steps."
      label="Data key"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.setCustomValidity(
          'Apply the new key or restore the original key.',
        );
        if (e.target.value === value) e.target.setCustomValidity('');
      }}
      onBlur={(e) => {
        try {
          onChange(draft);
          setError('');
          e.target.setCustomValidity('');
        } catch (err) {
          const message = (err as Error).message;
          setError(message);
          e.target.setCustomValidity(message);
        }
      }}
    />
  );
}
function Choices({
  schema,
  onChange,
  path,
}: {
  schema: Contract;
  onChange: (s: Contract) => void;
  path: string;
}) {
  const choices = schema.enum as string[];
  return (
    <div className={styles.choices}>
      <span className="hint">
        Allowed text values. Include “unknown” if it is a valid answer.
      </span>
      {choices.map((choice, index) => (
        <div className={styles.choice} key={index}>
          <TextInput
            aria-label={`${path} choice ${index + 1}`}
            value={choice}
            onChange={(e) =>
              onChange({
                ...schema,
                enum: choices.map((v, i) => (i === index ? e.target.value : v)),
              })
            }
          />
          <Button
            variant="ghost"
            aria-label={`Remove choice ${index + 1}`}
            disabled={choices.length === 1}
            onClick={() =>
              onChange({
                ...schema,
                enum: choices.filter((_, i) => i !== index),
              })
            }
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        onClick={() =>
          onChange({
            ...schema,
            enum: [...choices, `option${choices.length + 1}`],
          })
        }
      >
        <Plus />
        Add choice
      </Button>
    </div>
  );
}
function Bounds({
  schema,
  onChange,
  min,
  max,
  label,
  integer,
}: {
  schema: Contract;
  onChange: (s: Contract) => void;
  min: string;
  max: string;
  label: string;
  integer: boolean;
}) {
  return (
    <div className={styles.bounds}>
      {[min, max].map((key, index) => (
        <TextInput
          mb="md"
          key={key}
          label={
            <>
              {label} {index ? 'maximum' : 'minimum'}
            </>
          }
          type="number"
          step={integer ? 1 : 'any'}
          min={key.includes('Length') || key.includes('Items') ? 0 : undefined}
          value={schema[key] === undefined ? '' : Number(schema[key])}
          onChange={(e) => {
            const next = { ...schema };
            if (e.target.value === '') delete next[key];
            else next[key] = Number(e.target.value);
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
