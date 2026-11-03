import { NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import type {
  VariableImportBindings,
  VariableRequirement,
} from '@interlock/core';
import { VariablePicker } from './VariablePicker';

export function VariableImportBindingsEditor({
  requirements,
  choices,
  onChange,
  disabled,
}: {
  requirements: VariableRequirement[];
  choices: VariableImportBindings;
  onChange: (value: VariableImportBindings) => void;
  disabled: boolean;
}) {
  if (!requirements.length) return null;
  return (
    <fieldset
      disabled={disabled}
      style={{ border: 0, padding: 0, margin: '24px 0 0', minWidth: 0 }}
    >
      <Stack gap="lg">
        <div>
          <Text fw={550} size="sm">
            Required variables
          </Text>
          <Text size="xs" c="dimmed">
            Values are never imported. Choose a local value or provision an
            unset variable. Names do not bind automatically.
          </Text>
        </div>
        {requirements.map((r) => {
          const choice = choices[r.id];
          return (
            <Stack key={r.id} gap="sm">
              <NativeSelect
                label={`${r.name} · ${r.kind === 'secret' ? 'Secret' : 'Config'}`}
                value={choice?.action ?? ''}
                onChange={(e) =>
                  onChange({
                    ...choices,
                    [r.id]:
                      e.target.value === 'provision'
                        ? { action: 'provision', name: r.name }
                        : { action: 'bind' },
                  })
                }
              >
                <option value="" disabled>
                  Choose how to provide this variable
                </option>
                <option value="bind">Use a local variable</option>
                <option value="provision">
                  Provision locally, set the value later
                </option>
              </NativeSelect>
              {choice?.action === 'bind' && (
                <VariablePicker
                  kind={r.kind}
                  value={choice.variableId ?? ''}
                  onChange={(variableId) =>
                    onChange({
                      ...choices,
                      [r.id]: { action: 'bind', variableId },
                    })
                  }
                />
              )}
              {choice?.action === 'provision' && (
                <TextInput
                  label="Local name"
                  value={choice.name ?? r.name}
                  onChange={(e) =>
                    onChange({
                      ...choices,
                      [r.id]: { action: 'provision', name: e.target.value },
                    })
                  }
                />
              )}
            </Stack>
          );
        })}
      </Stack>
    </fieldset>
  );
}
