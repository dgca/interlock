import {
  ActionError,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalFooter,
  MultiSelect,
  Stack,
  Switch,
  TagsInput,
} from '../../design-system';
import { useState } from 'react';
import type { ProposalSettings } from '@interlock/core/proposals';
import { api } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';

const kinds = [
  'agent',
  'script',
  'fetch',
  'input',
  'wait',
  'condition',
  'switch',
  'workflow',
  'batch',
  'parallel',
  'entry',
  'exit',
].map((value) => ({
  value,
  label:
    value === 'input' ? 'Human input' : value[0].toUpperCase() + value.slice(1),
}));

/** Whether agents may propose changes to this workflow, and what they may touch. */
export function ProposalSettingsDialog({
  workflowId,
  settings,
  act,
  onClose,
}: {
  workflowId: string;
  settings: ProposalSettings;
  act: Action;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = (patch: Partial<ProposalSettings>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (!next.nodeKinds?.length) delete next.nodeKinds;
      if (!next.fields?.length) delete next.fields;
      if (!next.otherWorkflows) delete next.otherWorkflows;
      return next;
    });
  const save = () => {
    setPending(true);
    setError('');
    void act(
      async () => {
        await api.proposals.saveSettings.mutate({
          workflowId,
          settings: draft,
        });
        onClose();
      },
      'Proposal settings saved.',
      setError,
    ).finally(() => setPending(false));
  };
  return (
    <Modal
      title="Proposal settings"
      busy={pending}
      onClose={() => !pending && onClose()}
    >
      <ModalBody>
        <Stack gap="lg">
          <Switch
            label="Let agents propose changes"
            description="Agents call propose_workflow_change during a claim or as a connected client. People can always propose, and only people approve."
            checked={draft.agents}
            onChange={(event) => set({ agents: event.currentTarget.checked })}
          />
          <MultiSelect
            label="Node kinds agents may change"
            description="Leave empty to allow every kind. Route edits need both ends in the list."
            placeholder={draft.nodeKinds?.length ? undefined : 'All kinds'}
            data={kinds}
            value={draft.nodeKinds ?? []}
            disabled={!draft.agents}
            onChange={(value) =>
              set({ nodeKinds: value as ProposalSettings['nodeKinds'] })
            }
          />
          <TagsInput
            label="Fields agents may change"
            description="Leave empty to allow every field. With a list, agents can only update these fields, not add or remove nodes or routes."
            placeholder={
              draft.fields?.length ? undefined : 'All fields, such as prompt'
            }
            value={draft.fields ?? []}
            disabled={!draft.agents}
            onChange={(value) => set({ fields: value })}
          />
          <Checkbox
            label="Accept proposals from claims in other workflows' runs"
            checked={Boolean(draft.otherWorkflows)}
            disabled={!draft.agents}
            onChange={(event) =>
              set({ otherWorkflows: event.currentTarget.checked })
            }
          />
        </Stack>
      </ModalBody>
      <ModalFooter aside={<ActionError message={error} />}>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={pending}
          disabled={!dirty}
          onClick={save}
        >
          Save settings
        </Button>
      </ModalFooter>
    </Modal>
  );
}
