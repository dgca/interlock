import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import type { EditorProps } from './CodeEditor';
import styles from './CodeEditor.module.css';

export default function HighlightedEditor({
  textareaId,
  value,
  onChange,
  language,
}: EditorProps) {
  return (
    <Editor
      textareaId={textareaId}
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
  );
}
