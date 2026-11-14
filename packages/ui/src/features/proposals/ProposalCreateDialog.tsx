import {
  ActionError,
  Button,
  JsonEditor,
  Modal,
  ModalBody,
  ModalFooter,
  Stack,
  TextInput,
  Textarea,
} from '../../design-system';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { paths } from '../../routes/paths';

/** A person proposes edit_workflow operations for review, as an agent would. */
export function ProposalCreateDialog({
  workflowId,
  act,
  onClose,
}: {
  workflowId: string;
  act: Action;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [edits, setEdits] = useState<unknown[]>([]);
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dirty = Boolean(title || rationale || edits.length);
  const dismissal = useDraftDismissal(dirty, pending, onClose);
  const ready = title.trim() && rationale.trim() && edits.length && valid;
  return (
    <>
      <Modal
        title="New proposal"
        size={640}
        busy={pending}
        covered={Boolean(dismissal.covered)}
        onClose={dismissal.dismiss}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            setPending(true);
            setError('');
            void act(
              async () => {
                const proposal = await api.proposals.create.mutate({
                  workflowId,
                  title: title.trim(),
                  rationale: rationale.trim(),
                  edits: edits as never,
                });
                onClose();
                void navigate(paths.workflowProposals(workflowId, proposal.id));
              },
              'Proposal created.',
              setError,
            ).finally(() => setPending(false));
          }}
        >
          <ModalBody>
            <Stack gap="md">
              <TextInput
                label="Title"
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
              <Textarea
                label="Rationale"
                required
                autosize
                minRows={3}
                maxLength={4000}
                value={rationale}
                onChange={(event) => setRationale(event.currentTarget.value)}
              />
              <JsonEditor
                label="Operations (edit_workflow edits)"
                rows={10}
                value={edits}
                onValidityChange={setValid}
                validate={(value) =>
                  Array.isArray(value) && value.length
                    ? undefined
                    : 'Enter a list of at least one edit.'
                }
                onChange={(value: unknown[]) => setEdits(value)}
              />
            </Stack>
          </ModalBody>
          <ModalFooter aside={<ActionError message={error} />}>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={dismissal.dismiss}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={!ready}
            >
              Create proposal
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      {dismissal.confirmation}
    </>
  );
}
