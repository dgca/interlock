import {
  Input,
  SegmentedControl,
  Button,
  CodeEditor,
} from '../../design-system';

import { useRef, useState } from 'react';

type Language = 'javascript' | 'bash';
type Code = { language?: Language; command: string };
const names = { javascript: 'JavaScript', bash: 'Bash' };
const bashStarter = 'cat';

export function ScriptCode({
  value,
  onChange,
  polling = false,
  title,
}: {
  value: Code;
  onChange: (value: Code) => void;
  polling?: boolean;
  /** Names this code when a form holds more than one, as in workspace hooks. */
  title?: string;
}) {
  const prefix = title ? `${title} ` : polling ? 'Check ' : '';
  const drafts = useRef<
    Partial<Record<Language, { code: Code; carriedFrom?: Language }>>
  >({});
  const [carriedFrom, setCarriedFrom] = useState<Language>();
  const language = value.language ?? 'bash';
  const javascriptStarter = polling
    ? 'return { ready: true };'
    : 'return input;';
  const starter = language === 'javascript' ? javascriptStarter : bashStarter;
  const changeLanguage = (next: Language) => {
    drafts.current[language] = {
      code: { language: value.language, command: value.command },
      carriedFrom,
    };
    const previous = drafts.current[next];
    const hasCustomCode = value.command.trim() && value.command !== starter;
    setCarriedFrom(
      previous ? previous.carriedFrom : hasCustomCode ? language : undefined,
    );
    onChange(
      previous?.code ?? {
        language: next,
        command: hasCustomCode
          ? value.command
          : next === 'javascript'
            ? javascriptStarter
            : bashStarter,
      },
    );
  };
  return (
    <>
      <Input.Wrapper label={title ? `${title} language` : 'Language'} mb="md">
        <SegmentedControl
          mt={4}
          style={{ display: 'flex', width: 'fit-content' }}
          aria-label={prefix ? `${prefix}language` : 'Language'}
          value={language}
          data={[
            { value: 'javascript', label: 'JavaScript' },
            { value: 'bash', label: 'Bash' },
          ]}
          onChange={(next) => changeLanguage(next as Language)}
        />
      </Input.Wrapper>
      {carriedFrom && (
        <div>
          <p className="hint" role="status">
            Code carried over from {names[carriedFrom]}. Review it before
            running with {names[language]}.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              onChange({ language, command: starter });
              setCarriedFrom(undefined);
            }}
          >
            Use {names[language]} starter
          </Button>
        </div>
      )}
      <CodeEditor
        label={`${prefix}${language === 'javascript' ? 'JavaScript code' : 'Bash command'}`}
        language={language}
        value={value.command}
        onChange={(command) => onChange({ language: value.language, command })}
      />
    </>
  );
}
