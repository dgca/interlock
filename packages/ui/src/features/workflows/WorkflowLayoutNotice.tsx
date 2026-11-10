import { Button, Group, Text } from '../../design-system';
import { usePendingWorkflowLayouts } from './useWorkflowLayout';

/** Keep interrupted layout saves visible after leaving their editor. */
export function WorkflowLayoutNotice({
  currentWorkflowId,
  onOpen,
}: {
  currentWorkflowId?: string;
  onOpen: (id: string) => void;
}) {
  const layouts = usePendingWorkflowLayouts();
  return layouts
    .filter((layout) => layout.id !== currentWorkflowId)
    .map((layout) => (
      <Group
        key={layout.id}
        className="engine-warning"
        justify="space-between"
        gap="xs"
        role={layout.error ? 'alert' : 'status'}
      >
        <Text size="sm">
          {layout.error
            ? `Layout for ${layout.name} could not be saved. ${layout.error}`
            : `Saving layout for ${layout.name}…`}
        </Text>
        <Group gap="xs">
          <Button variant="secondary" onClick={() => onOpen(layout.id)}>
            Open workflow
          </Button>
          {layout.error && (
            <Button
              variant="secondary"
              disabled={layout.saving}
              onClick={() => void layout.retry()}
            >
              Retry layout save
            </Button>
          )}
        </Group>
      </Group>
    ));
}
