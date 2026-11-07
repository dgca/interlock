import type { ReactNode } from 'react';
import styles from './Modal.module.css';

export function ModalBody({
  children,
  flush = false,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div
      data-modal-body
      className={`${styles.main}${flush ? ` ${styles.flush}` : ''}`}
    >
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <footer data-modal-footer className={styles.footer}>
      {aside && <div className={styles.aside}>{aside}</div>}
      <div className={styles.actions}>{children}</div>
    </footer>
  );
}
