import {
  ActionIcon,
  Autocomplete,
  Button,
  JsonEditor,
  NumberInput,
  Select,
  TextInput,
} from '../../design-system';
import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Json, TestAssertion } from '@interlock/core';
import { draftKey, type checkTargets } from './suiteDraft';
import styles from './Testing.module.css';

type Target = ReturnType<typeof checkTargets>[number];
const operators = [
  { value: 'exists', label: 'Exists' },
  { value: 'equals', label: 'Equals' },
  { value: 'gte', label: 'At least' },
  { value: 'lte', label: 'At most' },
];

function changeKind(kind: string): TestAssertion {
  return kind === 'route'
    ? { kind: 'route', nodeId: '', visit: 1, port: '' }
    : { kind: 'output', path: '', visit: 1, operator: 'exists' };
}

function changeOperator(
  check: Extract<TestAssertion, { kind: 'output' }>,
  operator: string,
): TestAssertion {
  const { expected, ...rest } = check;
  const next = { ...rest, operator: operator as typeof check.operator };
  if (operator === 'exists') return next;
  if (operator === 'equals')
    return { ...next, expected: expected === undefined ? null : expected };
  return { ...next, expected: typeof expected === 'number' ? expected : 0 };
}

/** Checks for one case. Problems are keyed by `<prefix>.<index>[.<field>]`. */
export function CheckFields({
  checks,
  keys,
  onChange,
  targets,
  problems,
  prefix,
  validityPrefix,
  onValidityChange,
}: {
  checks: TestAssertion[];
  /** Stable key per check, parallel to `checks`, for JSON validity and focus. */
  keys: string[];
  onChange: (checks: TestAssertion[], keys: string[]) => void;
  targets: Target[];
  problems: Map<string, string>;
  prefix: string;
  validityPrefix: string;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const id = useId();
  const update = (index: number, check: TestAssertion) =>
    onChange(
      checks.map((c, i) => (i === index ? check : c)),
      keys,
    );
  // Replacing or removing an Expected JSON field discards its unsaved text.
  const replace = (index: number, check: TestAssertion) => {
    onValidityChange(`${validityPrefix}.${keys[index]}`, true);
    update(index, check);
  };
  const steps = targets.map((t) => ({
    value: t.id,
    label: t.label === t.id ? t.id : `${t.id} (${t.label})`,
  }));
  return (
    <div className={styles.checks}>
      {checks.map((check, index) => {
        const problem = (field?: string) =>
          problems.get(`${prefix}.${index}${field ? `.${field}` : ''}`);
        const number = index + 1;
        const ports =
          targets.find((t) => t.id === check.nodeId)?.ports ?? undefined;
        return (
          <div
            key={keys[index]}
            role="group"
            aria-labelledby={`${id}-${index}`}
            className={styles.check}
          >
            <div className={styles.checkHeader}>
              <span id={`${id}-${index}`}>Check {number}</span>
              <ActionIcon
                variant="subtle"
                aria-label={`Remove check ${number}`}
                onClick={() => {
                  onValidityChange(`${validityPrefix}.${keys[index]}`, true);
                  onChange(
                    checks.filter((_, i) => i !== index),
                    keys.filter((_, i) => i !== index),
                  );
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </ActionIcon>
            </div>
            <div className={styles.checkFields}>
              <Select
                label="Type"
                allowDeselect={false}
                data={[
                  { value: 'output', label: 'Output value' },
                  { value: 'route', label: 'Route taken' },
                ]}
                value={check.kind}
                onChange={(kind) =>
                  kind &&
                  kind !== check.kind &&
                  replace(index, changeKind(kind))
                }
              />
              <Autocomplete
                label="Step"
                required={check.kind === 'route'}
                placeholder={
                  check.kind === 'output' ? 'Workflow output' : undefined
                }
                data={steps}
                value={check.nodeId ?? ''}
                error={problem('nodeId')}
                onChange={(value) => {
                  const nodeId = value.trim();
                  if (check.kind === 'route')
                    update(index, { ...check, nodeId: value });
                  else {
                    // Without a step, the check reads the workflow output once.
                    update(
                      index,
                      nodeId
                        ? { ...check, nodeId: value }
                        : {
                            kind: 'output',
                            path: check.path,
                            operator: check.operator,
                            visit: 1,
                            ...(check.expected === undefined
                              ? {}
                              : { expected: check.expected }),
                          },
                    );
                  }
                }}
              />
              {(check.kind === 'route' || check.nodeId) && (
                <NumberInput
                  label="Visit"
                  min={1}
                  max={1000}
                  allowDecimal={false}
                  value={check.visit}
                  error={problem('visit')}
                  onChange={(value) =>
                    update(index, {
                      ...check,
                      visit: typeof value === 'number' ? value : 1,
                    })
                  }
                />
              )}
              {check.kind === 'route' ? (
                <Autocomplete
                  label="Route"
                  required
                  data={ports}
                  value={check.port}
                  error={problem('port') ?? problem()}
                  onChange={(port) => update(index, { ...check, port })}
                />
              ) : (
                <>
                  <TextInput
                    label="Path"
                    placeholder="Whole value"
                    value={check.path}
                    error={problem('path')}
                    classNames={{ input: styles.mono }}
                    onChange={(e) =>
                      update(index, { ...check, path: e.target.value })
                    }
                  />
                  <Select
                    label="Condition"
                    allowDeselect={false}
                    data={operators}
                    value={check.operator}
                    onChange={(operator) =>
                      operator &&
                      operator !== check.operator &&
                      replace(index, changeOperator(check, operator))
                    }
                  />
                  {check.operator === 'gte' || check.operator === 'lte' ? (
                    <NumberInput
                      label="Value"
                      required
                      value={
                        typeof check.expected === 'number' ? check.expected : ''
                      }
                      error={problem('expected') ?? problem()}
                      onChange={(value) =>
                        update(index, {
                          ...check,
                          expected: typeof value === 'number' ? value : 0,
                        })
                      }
                    />
                  ) : check.operator === 'equals' ? (
                    <div className={styles.wideField}>
                      <JsonEditor
                        label="Expected JSON"
                        rows={2}
                        value={check.expected ?? null}
                        onValidityChange={(valid) =>
                          onValidityChange(
                            `${validityPrefix}.${keys[index]}`,
                            valid,
                          )
                        }
                        onChange={(expected: Json) =>
                          update(index, { ...check, expected })
                        }
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>
            {check.kind === 'output' &&
              check.operator === 'equals' &&
              problem() && <p className={styles.fieldError}>{problem()}</p>}
          </div>
        );
      })}
      <div>
        <Button
          variant="ghost"
          disabled={checks.length >= 50}
          onClick={() =>
            onChange(
              [
                ...checks,
                { kind: 'output', path: '', visit: 1, operator: 'exists' },
              ],
              [...keys, draftKey()],
            )
          }
        >
          <Plus size={14} aria-hidden="true" /> Add check
        </Button>
      </div>
    </div>
  );
}
