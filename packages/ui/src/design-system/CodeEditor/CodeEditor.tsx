import { lazy, Suspense, useId } from 'react';
import styles from './CodeEditor.module.css';

export interface EditorProps {
  textareaId: string;
  language: 'javascript' | 'bash' | 'json';
  value: string;
  onChange: (value: string) => void;
}

function PlainEditor({ textareaId, value, onChange }: EditorProps) {
  return (
    <textarea
      id={textareaId}
      className={`${styles.editor} ${styles.plainEditor}`}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      rows={Math.max(6, value.split('\n').length)}
      wrap="off"
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      aria-description="Syntax highlighting is unavailable. Plain-text editing is still available."
    />
  );
}

const HighlightedEditor = /* @__PURE__ */ lazy(() =>
  import('./HighlightedEditor').catch(() => ({ default: PlainEditor })),
);

export function CodeEditor({
  label,
  language,
  value,
  onChange,
  fullHeight = false,
}: {
  label: string;
  language: 'javascript' | 'bash' | 'json';
  value: string;
  onChange: (value: string) => void;
  fullHeight?: boolean;
}) {
  const id = useId();
  return (
    <div className={`${styles.field} ${fullHeight ? styles.fullHeight : ''}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.frame}>
        <div className={styles.row}>
          <div className={styles.gutter} aria-hidden="true">
            {value.split('\n').map((_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <Suspense
            fallback={
              <div
                role="status"
                className={`${styles.editor} ${styles.loading}`}
              >
                Loading editor for {label}…
              </div>
            }
          >
            <HighlightedEditor
              textareaId={id}
              value={value}
              onChange={onChange}
              language={language}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
