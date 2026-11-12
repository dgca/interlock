import { Button, Modal, ModalBody, ModalFooter, Text } from '../design-system';

export function DiscardChangesDialog({
  onKeepEditing,
  onDiscard,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
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
        <Button variant="danger" onClick={onDiscard}>
          Discard changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}
