import {
  ActionError,
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Code,
  CodeEditor,
  Divider,
  EmptyState,
  FormPlaceholder,
  Group,
  JsonEditor,
  Loader,
  LoadingSkeleton,
  Menu,
  Modal,
  ModalBody,
  ModalFooter,
  MultiSelect,
  NativeSelect,
  Notification,
  NumberInput,
  PageHeader,
  PageTabList,
  PageTabsSkeleton,
  PageToolbar,
  Pagination,
  Pill,
  Placeholder,
  Progress,
  Radio,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Tabs,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  TrendBars,
  workspacePage,
} from '../design-system';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EllipsisVertical, Plus, Trash2 } from 'lucide-react';
import type { BoardTypeContent, Contract, Json } from '@interlock/core';
import { ContractEditor } from '../components/ContractEditor/ContractEditor';
import { WorkflowSyncAlertList } from '../features/workflows/WorkflowSyncAlerts';
import { Section, Specimen } from './GalleryLayout';
import { Testing } from './TestingSpecimens';
import { Proposals } from './ProposalSpecimens';
import { BoardCard, type BoardCardData } from '../features/boards/BoardCard';
import { LanesEditor } from '../features/boards/BoardTypeFields';
import boardClasses from '../features/boards/Boards.module.css';
import {
  ListTable,
  ListTableRow,
  ListTableSkeleton,
  type ListTableLayout,
} from '../components/ListTable/ListTable';
import { PageTabs } from '../components/PageLayout/PageLayout';
import { SchemaInput } from '../components/SchemaInput/SchemaInput';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import {
  WorkflowCard,
  WorkflowCardsSkeleton,
  WorkflowGrid,
} from '../components/WorkflowCards/WorkflowCards';
import { DiscardChangesDialog } from '../components/DiscardChangesDialog';
import { StartCostWarning } from '../features/runs/StartCostWarning';
import classes from './Gallery.module.css';

const options = ['Codex', 'Claude Code', 'Connected agent'];
const statuses = [
  'draft',
  'published',
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'needs_review',
  'open',
  'approved',
  'rejected',
];
const table: ListTableLayout = {
  columns: [
    { label: 'Name', width: '40%' },
    { label: 'Type', width: '20%' },
    { label: 'Status', width: '20%' },
    { label: 'Actions', fitContent: true },
  ],
  minWidth: 560,
};
const contract: Contract = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    priority: { type: 'number' },
    labels: { type: 'array', items: { type: 'string' } },
  },
  required: ['title'],
};
const schema = {
  type: 'object',
  properties: {
    repository: { type: 'string', title: 'Repository' },
    attempts: { type: 'integer', title: 'Attempts' },
    mode: { type: 'string', enum: ['review', 'apply'], title: 'Mode' },
  },
};
const script = `export default async function run({ input }) {
  return { summary: input.title.trim() };
}`;

function Buttons() {
  return (
    <Section id="buttons" title="Buttons">
      {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
        <Specimen key={variant} name={variant}>
          <Group gap="sm">
            <Button
              variant={variant}
              data-gallery-hover={
                variant === 'secondary' ? 'button' : undefined
              }
              data-gallery-focus={variant === 'primary' ? 'button' : undefined}
            >
              <Plus size={14} /> Action
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading>
              Loading
            </Button>
          </Group>
        </Specimen>
      ))}
      <Specimen name="ghost red">
        <Button variant="ghost" color="red">
          <Trash2 size={14} /> Delete
        </Button>
      </Specimen>
      <Specimen name="ActionIcon">
        <Group gap="sm">
          <ActionIcon variant="subtle" aria-label="More actions">
            <EllipsisVertical size={18} />
          </ActionIcon>
          <ActionIcon variant="subtle" aria-label="Disabled action" disabled>
            <EllipsisVertical size={18} />
          </ActionIcon>
          <ActionIcon variant="subtle" aria-label="Loading action" loading>
            <EllipsisVertical size={18} />
          </ActionIcon>
        </Group>
      </Specimen>
      <Specimen name="Menu">
        <Menu>
          <Menu.Target>
            <Button>Open menu</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item>Duplicate</Menu.Item>
            <Menu.Item disabled>Archive</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Specimen>
      <Specimen name="Anchor">
        <Anchor href="#gallery-buttons" underline="hover">
          Link action
        </Anchor>
      </Specimen>
    </Section>
  );
}

function Inputs() {
  return (
    <Section id="inputs" title="Inputs">
      <Specimen name="TextInput">
        <Stack gap="sm">
          <TextInput
            label="Default"
            placeholder="Workflow name"
            data-gallery-focus="input"
          />
          <TextInput label="Filled" defaultValue="Release review" />
          <TextInput label="Disabled" defaultValue="Locked" disabled />
          <TextInput
            label="Error"
            defaultValue="release review"
            error="Use a unique name."
          />
          <TextInput
            label="With description"
            description="Shown to agents when they claim work."
          />
        </Stack>
      </Specimen>
      <Specimen name="Textarea">
        <Stack gap="sm">
          <Textarea label="Default" placeholder="Describe the step" />
          <Textarea label="Disabled" defaultValue="Read only" disabled />
          <Textarea label="Error" error="Enter a description." />
        </Stack>
      </Specimen>
      <Specimen name="NumberInput">
        <Stack gap="sm">
          <NumberInput label="Default" defaultValue={3} />
          <NumberInput label="Disabled" defaultValue={3} disabled />
          <NumberInput label="Error" defaultValue={-1} error="Use 0 or more." />
        </Stack>
      </Specimen>
      <Specimen name="Select">
        <Stack gap="sm">
          <Select label="Default" data={options} defaultValue="Codex" />
          <Select label="Disabled" data={options} disabled />
          <Select label="Error" data={options} error="Choose a harness." />
          <NativeSelect label="NativeSelect" data={options} />
        </Stack>
      </Specimen>
      <Specimen name="Multiple values">
        <Stack gap="sm">
          <MultiSelect
            label="MultiSelect"
            data={options}
            defaultValue={['Codex']}
          />
          <TagsInput label="TagsInput" defaultValue={['release', 'ui']} />
          <Autocomplete label="Autocomplete" data={options} />
        </Stack>
      </Specimen>
      <Specimen name="Choices">
        <Stack gap="sm">
          <Checkbox label="Checked" defaultChecked />
          <Checkbox label="Unchecked" />
          <Checkbox label="Disabled" disabled />
          <Switch label="Enabled" defaultChecked />
          <Switch label="Disabled" disabled />
          <Radio.Group label="Radio" defaultValue="fresh">
            <Group gap="md" mt={6}>
              <Radio value="fresh" label="Fresh" />
              <Radio value="current" label="Current" />
              <Radio value="off" label="Disabled" disabled />
            </Group>
          </Radio.Group>
        </Stack>
      </Specimen>
      <Specimen name="SegmentedControl">
        <Stack gap="sm">
          <SegmentedControl data={['List', 'Overview']} />
          <SegmentedControl data={['List', 'Overview']} disabled />
        </Stack>
      </Specimen>
    </Section>
  );
}

function Feedback() {
  return (
    <Section id="feedback" title="Feedback">
      <Specimen name="StatusBadge">
        <Group gap="xs">
          {statuses.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </Group>
      </Specimen>
      <Specimen name="Badge and Pill">
        <Group gap="xs">
          {['gray', 'blue', 'green', 'yellow', 'red'].map((color) => (
            <Badge key={color} color={color} variant="light">
              {color}
            </Badge>
          ))}
          <Pill>Pill</Pill>
          <Pill withRemoveButton>Removable</Pill>
        </Group>
      </Specimen>
      <Specimen name="Alert">
        <Stack gap="sm">
          <Alert title="Information">The engine restarted.</Alert>
          <Alert color="red" title="Error">
            The save failed.
          </Alert>
          <Alert color="yellow" title="Attention">
            Automation paused.
          </Alert>
        </Stack>
      </Specimen>
      <Specimen name="WorkflowSyncAlertList">
        <WorkflowSyncAlertList
          folder="~/team/workflows"
          items={[
            {
              file: 'release-notes.json',
              reason:
                'Not valid JSON: Unexpected token < in JSON at position 61',
            },
            {
              file: 'triage.json',
              workflowId: 'triage',
              reason:
                '"Triage" has draft edits in Interlock that are not in this file, and the file changed too. Publish or discard the draft to load the file, or restore the file.',
            },
          ]}
        />
      </Specimen>
      <Specimen name="Notification">
        <Notification title="Saved" withCloseButton={false}>
          Workflow published.
        </Notification>
      </Specimen>
      <Specimen name="ActionError">
        <ActionError message="The board changed. Reload to continue." />
      </Specimen>
      <Specimen name="Loader and Progress">
        <Stack gap="sm">
          <Loader size="sm" />
          <Progress value={60} aria-label="Progress" />
        </Stack>
      </Specimen>
      <Specimen name="Text">
        <Stack gap={4}>
          <Title order={3}>Title</Title>
          <Text>Body text</Text>
          <Text c="dimmed" size="sm">
            Dimmed helper text
          </Text>
          <Code>run_01</Code>
        </Stack>
      </Specimen>
    </Section>
  );
}

function Loading() {
  return (
    <Section id="loading" title="Loading">
      <Specimen name="LoadingSkeleton">
        <LoadingSkeleton label="Loading example" />
      </Specimen>
      <Specimen name="Placeholder and Skeleton">
        <Stack gap="xs">
          <Placeholder h={12} w="70%" />
          <Skeleton h={12} w="40%" animate={false} />
        </Stack>
      </Specimen>
      <Specimen name="FormPlaceholder">
        <FormPlaceholder />
      </Specimen>
      <Specimen name="ListTableSkeleton" wide>
        <ListTableSkeleton {...table} label="Loading rows">
          <Placeholder h={12} w="70%" />
          <Placeholder h={12} w="50%" />
          <Placeholder h={12} w="40%" />
          <Placeholder h={12} w={40} />
        </ListTableSkeleton>
      </Specimen>
      <Specimen name="WorkflowCardsSkeleton" wide>
        <WorkflowCardsSkeleton />
      </Specimen>
    </Section>
  );
}

function Collections() {
  return (
    <Section id="collections" title="Collections">
      <Specimen name="ListTable" wide>
        <ListTable {...table} label="Example variables">
          {[
            ['RELEASE_CHANNEL', 'Config', 'completed'],
            ['GITHUB_TOKEN', 'Secret', 'failed'],
          ].map(([name, kind, status]) => (
            <ListTableRow key={name}>
              <Anchor href="#gallery-collections" underline="hover">
                {name}
              </Anchor>
              <Badge variant="light" color="gray" size="sm">
                {kind}
              </Badge>
              <StatusBadge status={status} />
              <Button variant="ghost" size="xs">
                Edit
              </Button>
            </ListTableRow>
          ))}
        </ListTable>
      </Specimen>
      <Specimen name="Table">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Key</Table.Th>
              <Table.Th>Value</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>stage</Table.Td>
              <Table.Td>Review</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Specimen>
      <Specimen name="EmptyState">
        <EmptyState
          title="No variables yet"
          description="Reuse settings and credentials across workflows."
        >
          <Button>Create a variable</Button>
        </EmptyState>
      </Specimen>
      <Specimen name="EmptyState without action">
        <EmptyState title="No matching variables" />
      </Specimen>
      <Specimen name="WorkflowCard" wide>
        <WorkflowGrid>
          <WorkflowCard
            name="Release review"
            description="Checks a release branch, runs tests, and asks for approval before publishing."
            to="#gallery-collections"
            metadata={['5 nodes', 'Version 3'].join(' · ')}
            status={<StatusBadge status="published" />}
          />
          <WorkflowCard
            name="Draft workflow"
            onOpen={() => undefined}
            disabled
            metadata="2 nodes"
            status={<StatusBadge status="draft" />}
          />
        </WorkflowGrid>
      </Specimen>
      <Specimen name="Pagination">
        <Pagination total={5} defaultValue={2} />
      </Specimen>
      <Specimen name="TrendBars">
        <TrendBars
          label="Runs started per day"
          values={[4, 9, 0, 6, 14, 11, 7].map((value, index) => ({
            label: `Day ${index + 1}`,
            value,
            display: `${value} runs`,
          }))}
        />
      </Specimen>
      <Specimen name="TrendBars with unmeasured intervals">
        <TrendBars
          label="Median run duration per day"
          values={[null, 52, null, 71, 64].map((value, index) => ({
            label: `Day ${index + 1}`,
            value,
            display: value === null ? 'No runs' : `${value} min`,
          }))}
        />
      </Specimen>
    </Section>
  );
}

function Layout() {
  return (
    <Section id="layout" title="Page layout">
      <Specimen name="PageHeader" wide>
        <PageHeader
          title="Variables"
          subtitle="2 variables"
          onBack={() => undefined}
          controls={<TextInput aria-label="Search" placeholder="Search" />}
          actions={
            <Button variant="primary">
              <Plus size={14} /> New variable
            </Button>
          }
        />
      </Specimen>
      <Specimen name="PageHeader busy" wide>
        <PageHeader
          title="Saving prompt"
          status="Saving…"
          onBack={() => undefined}
          busy
        />
      </Specimen>
      <Specimen name="PageTabs">
        <PageTabs
          label="Gallery tabs"
          value="active"
          items={[
            { value: 'active', label: 'Active', count: 4, to: '#active' },
            { value: 'archived', label: 'Archived', count: 1, to: '#archived' },
          ]}
        />
      </Specimen>
      <Specimen name="PageTabList">
        <Tabs defaultValue="list">
          <PageTabList
            label="Gallery sections"
            items={[
              { value: 'list', label: 'List', count: 2 },
              { value: 'history', label: 'History' },
            ]}
          />
        </Tabs>
      </Specimen>
      <Specimen name="PageTabsSkeleton">
        <PageTabsSkeleton
          value="active"
          items={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </Specimen>
      <Specimen name="PageToolbar">
        <PageToolbar summary="3 runs">
          <Button size="xs">Filter</Button>
        </PageToolbar>
      </Specimen>
      <Specimen name="Divider">
        <Divider />
      </Specimen>
    </Section>
  );
}

function Editors() {
  const [code, setCode] = useState(script);
  const [json, setJson] = useState<unknown>({ title: 'Release', retries: 2 });
  const [value, setValue] = useState<Contract>(contract);
  const [input, setInput] = useState<Record<string, Json>>({
    repository: 'dgca/interlock',
    attempts: 2,
    mode: 'review',
  });
  return (
    <Section id="editors" title="Editors">
      <Specimen name="CodeEditor" wide>
        <CodeEditor
          label="Script"
          language="javascript"
          value={code}
          onChange={setCode}
        />
      </Specimen>
      <Specimen name="JsonEditor">
        <JsonEditor label="Input" value={json} onChange={setJson} rows={5} />
      </Specimen>
      <Specimen name="JsonEditor read only">
        <JsonEditor label="Output" value={{ approved: true }} rows={3} />
      </Specimen>
      <Specimen name="ContractEditor">
        <Stack gap="sm">
          <ContractEditor label="Input" value={value} onChange={setValue} />
          <ContractEditor label="Output" value={{}} readOnly />
        </Stack>
      </Specimen>
      <Specimen name="SchemaInput">
        <SchemaInput schema={schema} value={input} onChange={setInput} />
      </Specimen>
      <Specimen name="SchemaInput disabled">
        <SchemaInput
          schema={schema}
          value={input}
          onChange={setInput}
          disabledKeys={['repository', 'attempts', 'mode']}
        />
      </Specimen>
    </Section>
  );
}

function Dialogs() {
  const [params, setParams] = useSearchParams();
  const open = params.get('open');
  const show = (value: string | null) =>
    setParams(value ? { open: value } : {}, { replace: true });
  return (
    <Section id="dialogs" title="Dialogs">
      <Specimen name="Modal">
        <Group gap="sm">
          <Button onClick={() => show('modal')}>Open modal</Button>
          <Button onClick={() => show('busy')}>Open busy modal</Button>
          <Button onClick={() => show('discard')}>Open discard dialog</Button>
          <Button onClick={() => show('start-warning')}>
            Open start cost warning
          </Button>
        </Group>
      </Specimen>
      {(open === 'modal' || open === 'busy') && (
        <Modal
          title="Rename workflow"
          busy={open === 'busy'}
          onClose={() => show(null)}
        >
          <ModalBody>
            <TextInput
              label="Name"
              defaultValue="Release review"
              disabled={open === 'busy'}
            />
          </ModalBody>
          <ModalFooter aside={<Text size="sm">Changes apply to drafts.</Text>}>
            <Button onClick={() => show(null)} disabled={open === 'busy'}>
              Cancel
            </Button>
            <Button variant="primary" loading={open === 'busy'}>
              Save
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {open === 'start-warning' && (
        <Modal title="Run Release notes" onClose={() => show(null)}>
          <ModalBody>
            <StartCostWarning
              cost={{
                currency: 'USD',
                medianMicros: 4_200_000,
                sampleSize: 5,
                thresholdMicros: 2_000_000,
                exceedsThreshold: true,
              }}
            />
            <TextInput label="Run title" />
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => show(null)}>Cancel</Button>
            <Button variant="primary">Start anyway</Button>
          </ModalFooter>
        </Modal>
      )}
      {open === 'discard' && (
        <DiscardChangesDialog
          onKeepEditing={() => show(null)}
          onDiscard={() => show(null)}
        />
      )}
    </Section>
  );
}

const hour = 3_600_000;
const boardCards: BoardCardData[] = [
  {
    id: 'task:github/481',
    runId: 'run-481',
    runCount: 2,
    workflowName: 'Feature',
    externalTask: {
      system: 'github',
      id: '481',
      title:
        'Keep board placement stable when a long-running review is retried after a failed check',
      url: 'https://github.com/example/app/issues/481',
    },
    status: 'waiting',
    stage: 'Review',
    actor: 'person',
    waiting: null,
    since: new Date(Date.now() - 3 * hour).toISOString(),
    attentionCount: 1,
    requestSummary: 'Approve the change plan',
    fields: {
      pr: 'https://github.com/example/app/pull/912',
      spend: '$4.18',
    },
  },
  {
    id: 'run:held',
    runId: 'run-held',
    workflowName: 'Dependency upgrade',
    title: 'Upgrade the test runner',
    status: 'queued',
    stage: null,
    actor: 'engine',
    waiting: null,
    held: { reason: 'Start after the release freeze' },
    since: new Date(Date.now() - 26 * hour).toISOString(),
    attentionCount: 0,
  },
];

function Boards() {
  const [lanes, setLanes] = useState<BoardTypeContent['lanes']>([
    { id: 'backlog', name: 'Backlog', match: [{ status: ['held'] }] },
    {
      id: 'review',
      name: 'Review',
      match: [
        {
          status: ['running', 'waiting'],
          stages: ['Review'],
        },
      ],
    },
  ]);
  return (
    <Section id="boards" title="Boards">
      <Specimen name="BoardCard with fields">
        <ul className={boardClasses.cards} role="list">
          <BoardCard
            card={boardCards[0]}
            runLink="#gallery-boards"
            requestLink="#gallery-boards"
            fields={[
              { id: 'pr', label: 'Pull request' },
              { id: 'spend', label: 'Spend' },
            ]}
          />
        </ul>
      </Specimen>
      <Specimen name="BoardCard held">
        <ul className={boardClasses.cards} role="list">
          <BoardCard card={boardCards[1]} runLink="#gallery-boards" />
        </ul>
      </Specimen>
      <Specimen name="LanesEditor" wide>
        <LanesEditor lanes={lanes} disabled={false} onChange={setLanes} />
      </Specimen>
    </Section>
  );
}

/** Development-only route. Production builds never include this module. */
export default function Gallery() {
  return (
    <main className={classes.page} aria-label="Component gallery">
      <PageHeader title="Component gallery" />
      <div className={`${workspacePage.content} ${classes.content}`}>
        <Buttons />
        <Inputs />
        <Feedback />
        <Loading />
        <Collections />
        <Layout />
        <Editors />
        <Dialogs />
        <Testing />
        <Proposals />
        <Boards />
      </div>
    </main>
  );
}
