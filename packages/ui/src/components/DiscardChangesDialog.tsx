import { Button, Modal, ModalBody, ModalFooter, Text } from '../design-system';

export function DiscardChangesDialog({
  onKeepEditing,
  onDiscard,
  discardDisabled,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
  discardDisabled?: boolean;
}) {
  return (
    <Modal title="Discard unsaved changes?" onClose={onKeepEditing}>
      <ModalBody>
        <Text>You have changes that have not been saved.</Text>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" data-autofocus onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button variant="danger" disabled={discardDisabled} onClick={onDiscard}>
          Discard changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}
