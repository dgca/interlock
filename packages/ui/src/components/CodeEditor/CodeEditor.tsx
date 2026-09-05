import { useId } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import styles from './CodeEditor.module.css';

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
          <Editor
            textareaId={id}
            value={value}
            onValueChange={onChange}
            highlight={(code) =>
              Prism.highlight(code, Prism.languages[language], language)
            }
            padding={12}
            ignoreTabKey
            className={styles.editor}
            preClassName={styles.highlight}
          />
        </div>
      </div>
    </div>
  );
}
