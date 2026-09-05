import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { api, errorMessage } from '../../lib/api';
export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<{ command: string; args: string[] }>(),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    api.connection
      .query()
      .then(setConfig)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const json = JSON.stringify({ mcpServers: { interlock: config } }, null, 2);
  const toml = config
    ? `[mcp_servers.interlock]\ncommand = ${JSON.stringify(config.command)}\nargs = ${JSON.stringify(config.args)}`
    : '';
  return (
    <Modal title="Connect your harness" onClose={onClose}>
      <p className="hint">
        Keep the local engine running. Add Interlock as a stdio MCP server in
        your harness, then enable its tools.
      </p>
      <h3>Codex configuration</h3>
      <pre>{toml || 'Loading configuration…'}</pre>
      <Button
        disabled={!config}
        onClick={() =>
          void navigator.clipboard
            .writeText(toml)
            .then(() => setCopied(true))
            .catch((e) => setError(errorMessage(e)))
        }
      >
        <Copy />
        {copied ? 'Copied' : 'Copy Codex configuration'}
      </Button>
      <details>
        <summary>Generic MCP configuration</summary>
        <pre>{json}</pre>
      </details>
      <p className="hint">
        Ask your agent to start a workflow, claim available work, and submit
        each result until the run completes. Tool approval and fresh-session
        support depend on your harness.
      </p>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
