import { useEffect, useState } from 'react';
import { Checkbox, Tabs } from '@mantine/core';
import { Copy } from 'lucide-react';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { api, errorMessage } from '../../lib/api';

type Connection = Awaited<ReturnType<typeof api.connection.query>>;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<Connection>();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<string | null>('Codex');
  const [absolute, setAbsolute] = useState(false);
  useEffect(() => {
    api.connection
      .query()
      .then(setConfig)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const launch = absolute && config?.fallback ? config.fallback : config;
  const env = config?.env;
  const toml = launch
    ? `[mcp_servers.interlock]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}${
        env
          ? '\n\n[mcp_servers.interlock.env]\n' +
            Object.entries(env)
              .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
              .join('\n')
          : ''
      }`
    : '';
  const claude = launch
    ? [
        'claude',
        'mcp',
        'add',
        '--transport',
        'stdio',
        '--scope',
        'user',
        ...Object.entries(env ?? {}).flatMap(([key, value]) => [
          '--env',
          quote(`${key}=${value}`),
        ]),
        'interlock',
        '--',
        quote(launch.command),
        ...launch.args.map(quote),
      ].join(' ')
    : '';
  const opencode = launch
    ? JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            interlock: {
              type: 'local',
              command: [launch.command, ...launch.args],
              enabled: true,
              ...(env ? { environment: env } : {}),
            },
          },
        },
        null,
        2,
      )
    : '';
  const other = launch
    ? JSON.stringify(
        { command: launch.command, args: launch.args, ...(env ? { env } : {}) },
        null,
        2,
      )
    : '';
  const snippet =
    tab === 'Codex'
      ? toml
      : tab === 'Claude'
        ? claude
        : tab === 'OpenCode'
          ? opencode
          : other;
  return (
    <Modal title="Connect with MCP" onClose={onClose} size={680}>
      <p className="hint">
        Keep Interlock running while your harness uses its tools. After adding
        the configuration, restart or reconnect your harness.
      </p>
      {config?.development && (
        <p className="hint">
          This development server uses paths to this checkout. Installed copies
          use <code>interlock mcp</code>.
        </p>
      )}
      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setCopied(false);
        }}
      >
        <Tabs.List>
          {['Codex', 'Claude', 'OpenCode', 'Other'].map((name) => (
            <Tabs.Tab key={name} value={name}>
              {name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {tab === 'Codex' && (
        <p>
          Add this to <code>~/.codex/config.toml</code>.{' '}
          <a
            href="https://developers.openai.com/codex/mcp"
            target="_blank"
            rel="noreferrer"
          >
            Codex MCP docs
          </a>
        </p>
      )}
      {tab === 'Claude' && (
        <p>
          Run this in your terminal to add Interlock to Claude Code for your
          user account.{' '}
          <a
            href="https://code.claude.com/docs/en/mcp"
            target="_blank"
            rel="noreferrer"
          >
            Claude Code MCP docs
          </a>
        </p>
      )}
      {tab === 'OpenCode' && (
        <p>
          Merge this into your <code>opencode.json</code> configuration.{' '}
          <a
            href="https://opencode.ai/docs/mcp-servers/"
            target="_blank"
            rel="noreferrer"
          >
            OpenCode MCP docs
          </a>
        </p>
      )}
      {tab === 'Other' && (
        <p>
          Add a local MCP server using <strong>stdio</strong> transport and the
          command, arguments, and environment below. The harness starts the
          bridge process. The engine URL is{' '}
          <code>{config?.engineUrl ?? '…'}</code>; this is an internal HTTP API,
          not an HTTP MCP endpoint.
        </p>
      )}
      {config?.fallback && (
        <Checkbox
          label="Use absolute paths if your harness cannot find interlock"
          checked={absolute}
          onChange={(event) => {
            setAbsolute(event.currentTarget.checked);
            setCopied(false);
          }}
        />
      )}
      <pre>{snippet || 'Loading configuration…'}</pre>
      <Button
        disabled={!config}
        onClick={() =>
          void navigator.clipboard
            .writeText(snippet)
            .then(() => setCopied(true))
            .catch((e) => setError(errorMessage(e)))
        }
      >
        <Copy />
        {copied
          ? 'Copied'
          : tab === 'Claude'
            ? 'Copy command'
            : 'Copy configuration'}
      </Button>
      {tab === 'Claude' && config && (
        <details>
          <summary>Claude Desktop configuration</summary>
          <p>Merge this into your Claude Desktop MCP configuration.</p>
          <pre>
            {JSON.stringify(
              { mcpServers: { interlock: JSON.parse(other) } },
              null,
              2,
            )}
          </pre>
        </details>
      )}
      <p className="hint">
        Ask your agent to find a workflow, start it with your input, and
        complete its assignments. Your harness controls tool approval and agent
        capabilities.
      </p>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
