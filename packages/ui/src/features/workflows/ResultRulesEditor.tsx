import { NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import type { ResultRule } from '@interlock/core';
import { Button } from '../../components/Button/Button';

export function ResultRulesEditor({
  value = [],
  onChange,
}: {
  value?: ResultRule[];
  onChange: (rules: ResultRule[] | undefined) => void;
}) {
  const save = (rules: ResultRule[]) =>
    onChange(rules.length ? rules : undefined);
  const update = (index: number, rule: ResultRule) =>
    save(value.map((r, i) => (i === index ? rule : r)));
  return (
    <Stack gap="sm" my="md">
      <Text fw={600}>Result checks</Text>
      {value.length > 0 && (
        <Text size="sm" c="dimmed">
          Checks run before acceptance. Blank paths select the whole value.
        </Text>
      )}
      {value.map((rule, index) => (
        <Stack
          key={index}
          gap="xs"
          p="sm"
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 4,
          }}
        >
          <TextInput
            label="Check ID"
            value={rule.id}
            maxLength={64}
            onChange={(e) =>
              update(index, { ...rule, id: e.currentTarget.value })
            }
          />
          <NativeSelect
            label="Check"
            value={rule.kind}
            data={[
              { value: 'exists', label: 'Output path exists' },
              { value: 'equalsInput', label: 'Output matches input' },
            ]}
            onChange={(e) =>
              update(
                index,
                e.currentTarget.value === 'exists'
                  ? { id: rule.id, kind: 'exists', outputPath: rule.outputPath }
                  : { ...rule, kind: 'equalsInput', inputPath: '' },
              )
            }
          />
          <TextInput
            label="Output path"
            value={rule.outputPath}
            maxLength={256}
            onChange={(e) =>
              update(index, { ...rule, outputPath: e.currentTarget.value })
            }
          />
          {rule.kind === 'equalsInput' && (
            <TextInput
              label="Captured input path"
              value={rule.inputPath}
              maxLength={256}
              onChange={(e) =>
                update(index, { ...rule, inputPath: e.currentTarget.value })
              }
            />
          )}
          <Button
            variant="ghost"
            onClick={() => save(value.filter((_, i) => i !== index))}
          >
            Remove check
          </Button>
        </Stack>
      ))}
      <Button
        variant="ghost"
        disabled={value.length >= 32}
        onClick={() => {
          let n = 1;
          while (value.some((r) => r.id === `check-${n}`)) n++;
          save([
            ...value,
            {
              id: `check-${n}`,
              kind: 'equalsInput',
              outputPath: '',
              inputPath: '',
            },
          ]);
        }}
      >
        Add result check
      </Button>
    </Stack>
  );
}
