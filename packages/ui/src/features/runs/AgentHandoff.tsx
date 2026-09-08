import { Alert } from '@mantine/core';
import { useState } from 'react';
import { Bot, Copy } from 'lucide-react';
import { Button } from '../../components/Button/Button';
import { errorMessage } from '../../lib/api';

export function AgentHandoff({
  runId,
  onConnect,
}: {
  runId: string;
  onConnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    setCopied(false);
    setError('');
    try {
      await navigator.clipboard.writeText(
        `Continue existing Interlock run ${runId}. Do not start a new run.\n` +
          `Inspect it with get_run and use list_work with runId "${runId}" to find available assignments, including child runs. ` +
          "Claim assignments using your actual capabilities. Follow each assignment's prompt, input, context policy, and output schema, then submit JSON with its claim token. " +
          'Follow executionInstructions when present, including isolation and user handoff guidance for fresh-context assignments. Do not claim fresh context in an existing conversation. Renew claims before they expire. ' +
          'Continue until this run completes, fails, or is cancelled. If another worker has claimed an assignment, do not take over its claim. Report any blocker.',
      );
      setCopied(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Alert
      icon={<Bot size={18} />}
      title="Waiting for an agent"
      color="blue"
      role="status"
    >
      <p>
        Interlock has prepared an assignment. Ask your connected agent to
        continue this run. Connecting an agent does not automatically pick up
        work.
      </p>
      <div className="actions">
        <Button onClick={() => void copy()}>
          <Copy />
          {copied ? 'Instructions copied' : 'Copy instructions for agent'}
        </Button>
        <Button onClick={onConnect}>Connect an agent</Button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </Alert>
  );
}
