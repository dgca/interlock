import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EllipsisVertical } from 'lucide-react';
import {
  ActionError,
  ActionIcon,
  Button,
  Menu,
  Modal,
  ModalBody,
  ModalFooter,
  Textarea,
} from '../../design-system';
import stretched from '../../components/StretchedLink.module.css';
import { api, errorMessage } from '../../lib/api';
import { refreshQueries, trpc, useQueryClient } from '../../lib/query';
import { paths } from '../../routes/paths';
import { RunCancellationDialog } from '../runs/RunCancellationDialog';

type Card = { runId: string; actions?: string[] };

/**
 * The only way a board changes run state: each action is an existing run
 * operation, offered only when the card's run allows it.
 */
export function BoardCardActions({
  card,
  title,
  runLink,
  returnTo,
}: {
  card: Card;
  title: string;
  runLink: string;
  returnTo: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState<'cancel' | 'backlog' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actions = new Set(card.actions);
  const run = async (mutation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await mutation();
      await Promise.all([
        refreshQueries(client),
        client.invalidateQueries(trpc.boards.view.queryFilter()),
      ]);
      setOpen(null);
      // The card moved lanes; keep focus on it rather than the page body.
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            `[data-card-run="${CSS.escape(card.runId)}"] h3 a`,
          )
          ?.focus(),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const menu = ['cancel', 'backlog'].some((action) => actions.has(action));
  return (
    <>
      {actions.has('release') && (
        <Button
          variant="ghost"
          className={stretched.action}
          loading={busy && !open}
          onClick={() =>
            void run(() => api.boards.release.mutate({ runId: card.runId }))
          }
        >
          Release
        </Button>
      )}
      {menu && (
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              className={stretched.action}
              aria-label={`Actions for ${title}`}
            >
              <EllipsisVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item component={Link} to={runLink}>
              Open run
            </Menu.Item>
            {actions.has('backlog') && (
              <Menu.Item onClick={() => setOpen('backlog')}>
                Move to backlog
              </Menu.Item>
            )}
            {actions.has('cancel') && (
              <Menu.Item color="red" onClick={() => setOpen('cancel')}>
                Cancel run
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
      {error && !open && <ActionError message={error} />}
      {open === 'cancel' && (
        <RunCancellationDialog
          runId={card.runId}
          onClose={() => setOpen(null)}
          onOpen={(id) => void navigate(paths.run(id, { returnTo }))}
        />
      )}
      {open === 'backlog' && (
        <Modal
          title="Move to backlog"
          busy={busy}
          onClose={() => setOpen(null)}
        >
          <ModalBody>
            <Textarea
              label="Reason"
              description="The run stays queued until someone releases it. Only runs that have not started can move to the backlog."
              required
              autosize
              minRows={2}
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <ActionError message={error} />
          </ModalBody>
          <ModalFooter>
            <Button disabled={busy} onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!reason.trim()}
              onClick={() =>
                void run(() =>
                  api.boards.hold.mutate({
                    runId: card.runId,
                    reason: reason.trim(),
                  }),
                )
              }
            >
              Move to backlog
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
