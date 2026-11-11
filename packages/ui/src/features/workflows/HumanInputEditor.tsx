import {
  ActionIcon,
  Button,
  Group,
  NativeSelect,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '../../design-system';
import type { Contract, HumanInput } from '@interlock/core';
import { Plus, X } from 'lucide-react';
import { InputPathInput } from './InputPathInput';

export function HumanInputEditor({
  value,
  input,
  onChange,
}: {
  value: HumanInput;
  input: Contract;
  onChange: (value: HumanInput) => void;
}) {
  const patch = (changes: Partial<HumanInput>) =>
    onChange({ ...value, ...changes });
  const answer = value.answer;
  return (
    <Stack gap="md">
      <Textarea
        label="Question"
        required
        autosize
        minRows={2}
        maxLength={4000}
        value={value.question}
        onChange={(event) => patch({ question: event.currentTarget.value })}
      />
      <Textarea
        label="Context"
        autosize
        minRows={2}
        maxLength={32000}
        value={value.context ?? ''}
        onChange={(event) =>
          patch({ context: event.currentTarget.value || undefined })
        }
      />
      <details
        open={
          value.questionPath || value.contextPath || value.evidence
            ? true
            : undefined
        }
      >
        <summary>Use input data in the request</summary>
        <Stack gap="sm">
          <InputPathInput
            label="Question input path"
            schema={input}
            stringsOnly
            value={value.questionPath ?? ''}
            onChange={(path) => patch({ questionPath: path || undefined })}
          />
          <InputPathInput
            label="Context input path"
            schema={input}
            stringsOnly
            value={value.contextPath ?? ''}
            onChange={(path) => patch({ contextPath: path || undefined })}
          />
          <Switch
            label="Include evidence"
            checked={Boolean(value.evidence)}
            onChange={(event) =>
              patch({
                evidence: event.currentTarget.checked
                  ? { title: '', contentPath: '' }
                  : undefined,
              })
            }
          />
          {value.evidence && (
            <>
              <TextInput
                label="Evidence title"
                required
                maxLength={200}
                value={value.evidence.title}
                onChange={(event) =>
                  patch({
                    evidence: {
                      ...value.evidence!,
                      title: event.currentTarget.value,
                    },
                  })
                }
              />
              <InputPathInput
                label="Evidence content input path"
                required
                schema={input}
                stringsOnly
                value={value.evidence.contentPath}
                onChange={(path) =>
                  patch({ evidence: { ...value.evidence!, contentPath: path } })
                }
              />
              <InputPathInput
                label="Evidence revision input path"
                schema={input}
                stringsOnly
                value={value.evidence.revisionPath ?? ''}
                onChange={(path) =>
                  patch({
                    evidence: {
                      ...value.evidence!,
                      revisionPath: path || undefined,
                    },
                  })
                }
              />
            </>
          )}
        </Stack>
      </details>
      <NativeSelect
        label="Answer format"
        value={answer.kind}
        data={[
          { value: 'text', label: 'Text' },
          { value: 'choice', label: 'Single choice' },
        ]}
        onChange={(event) =>
          patch({
            answer:
              event.currentTarget.value === 'text'
                ? { kind: 'text' }
                : {
                    kind: 'choice',
                    choices: [{ label: '', value: '' }],
                  },
          })
        }
      />
      {answer.kind === 'choice' && (
        <Stack gap="sm">
          {answer.choices.map((choice, index) => {
            const edit = (change: Partial<typeof choice>) =>
              patch({
                answer: {
                  kind: 'choice',
                  choices: answer.choices.map((item, position) =>
                    position === index ? { ...item, ...change } : item,
                  ),
                },
              });
            return (
              <Group key={index} align="flex-end" gap="xs">
                <TextInput
                  label={`Choice ${index + 1} label`}
                  required
                  maxLength={120}
                  value={choice.label}
                  onChange={(event) =>
                    edit({ label: event.currentTarget.value })
                  }
                />
                <TextInput
                  label={`Choice ${index + 1} value`}
                  required
                  maxLength={120}
                  value={choice.value}
                  onChange={(event) =>
                    edit({ value: event.currentTarget.value })
                  }
                />
                <Switch
                  mb={8}
                  label="Require comment"
                  checked={Boolean(choice.requireComment)}
                  onChange={(event) =>
                    edit({ requireComment: event.currentTarget.checked })
                  }
                />
                <ActionIcon
                  mb={7}
                  variant="subtle"
                  disabled={answer.choices.length === 1}
                  aria-label={`Remove choice ${index + 1}`}
                  onClick={() =>
                    patch({
                      answer: {
                        kind: 'choice',
                        choices: answer.choices.filter(
                          (_, position) => position !== index,
                        ),
                      },
                    })
                  }
                >
                  <X size={15} />
                </ActionIcon>
              </Group>
            );
          })}
          <Group>
            <Button
              variant="ghost"
              disabled={answer.choices.length >= 20}
              onClick={() =>
                patch({
                  answer: {
                    kind: 'choice',
                    choices: [...answer.choices, { label: '', value: '' }],
                  },
                })
              }
            >
              <Plus size={16} /> Add choice
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
