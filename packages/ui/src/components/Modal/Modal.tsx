import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../Button/Button';
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal">
      <header>
        <h2>{title}</h2>
        <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
          <X />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
