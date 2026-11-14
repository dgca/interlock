import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import {
  ActionError,
  Button,
  JsonEditor,
  PageHeader,
  SegmentedControl,
  Stack,
  TextInput,
  Textarea,
  workspacePage,
} from '../../design-system';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  simulationFixtureSchema,
  type Json,
  type TestSuite,
  type Workflow,
} from '@interlock/core';
import { SchemaInput } from '../../components/SchemaInput/SchemaInput';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQueryClient } from '../../lib/query';
import { paths } from '../../routes/paths';
import { CheckFields } from './CheckFields';
import {
  checkTargets,
  emptyCase,
  emptySuite,
  issueText,
  sameSuiteDraft,
  suiteContent,
  suiteDraft,
  suiteProblems,
  type CaseDraft,
  type SuiteDraft,
} from './suiteDraft';
import styles from './Testing.module.css';

const suiteConflict = 'Suite changed. Read its current revision before saving';

function fixtureProblem(value: unknown) {
  if (!Array.isArray(value)) return 'Enter a JSON array of fixtures.';
  if (value.length > 1000) return 'A case allows at most 1,000 fixtures.';
  for (const [index, fixture] of value.entries()) {
    const parsed = simulationFixtureSchema.safeParse(fixture);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue.path.length ? ` ${issue.path.join('.')}` : '';
      return `Fixture ${index + 1}${field}: ${issueText(issue)}`;
    }
  }
}

function CaseFields({
  value,
  index,
  workflow,
  problems,
  canRemove,
  onChange,
  onRemove,
  onValidityChange,
}: {
  value: CaseDraft;
  index: number;
  workflow: Workflow;
  problems: Map<string, string>;
  canRemove: boolean;
  onChange: (value: CaseDraft) => void;
  onRemove: () => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const [rawInput, setRawInput] = useState(false);
  const headingId = useId();
  // Problems follow the saved shape; JSON validity follows the case itself.
  const prefix = `cases.${index}`;
  const own = value.key;
  const schema = workflow.draft.inputSchema;
  const canForm =
    schema?.type === 'object' &&
    Boolean(schema.properties) &&
    value.input !== null &&
    typeof value.input === 'object' &&
    !Array.isArray(value.input);
  return (
    <section className={styles.case} aria-labelledby={headingId}>
      <div className={styles.caseHeading}>
        <h3 id={headingId}>
          Case {index + 1}
          {value.name.trim() && <span>{value.name}</span>}
        </h3>
        <Button
          variant="ghost"
          disabled={!canRemove}
          aria-label={`Remove case ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" /> Remove
        </Button>
      </div>
      <Stack gap="md">
        <div className={styles.pair}>
          <TextInput
            label="Name"
            required
            maxLength={120}
            value={value.name}
            error={problems.get(`${prefix}.name`)}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          <TextInput
            label="Case ID"
            description="Results refer to this ID. Keep it when renaming."
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            required
            maxLength={120}
            classNames={{ input: styles.mono }}
            value={value.id}
            error={problems.get(`${prefix}.id`)}
            onChange={(e) => onChange({ ...value, id: e.target.value })}
          />
        </div>
        <div>
          <SegmentedControl
            aria-label={`Case ${index + 1} input source`}
            value={value.source}
            data={[
              { value: 'input', label: 'Enter input' },
              { value: 'run', label: 'Copy from a run' },
            ]}
            onChange={(source) => {
              onValidityChange(`${own}.input`, true);
              onChange({
                ...value,
                source: source === 'run' ? 'run' : 'input',
              });
            }}
          />
        </div>
        {value.source === 'run' ? (
          <TextInput
            label="Source run ID"
            description="Saving copies this run's input. The run must belong to this workflow."
            required
            classNames={{ input: styles.mono }}
            value={value.sourceRunId}
            error={
              problems.get(`${prefix}.sourceRunId`) ?? problems.get(prefix)
            }
            onChange={(e) =>
              onChange({ ...value, sourceRunId: e.target.value })
            }
          />
        ) : (
          <div>
            {canForm && (
              <Button
                variant="ghost"
                mb="xs"
                onClick={() => {
                  onValidityChange(`${own}.input`, true);
                  setRawInput(!rawInput);
                }}
              >
                {rawInput ? 'Use input fields' : 'Edit input as JSON'}
              </Button>
            )}
            {canForm && !rawInput ? (
              <SchemaInput
                schema={schema}
                value={value.input as Record<string, Json>}
                onChange={(input) =>
                  onChange({ ...value, input, captured: undefined })
                }
                onValidityChange={(valid) =>
                  onValidityChange(`${own}.input`, valid)
                }
              />
            ) : (
              <JsonEditor
                label="Workflow input"
                rows={6}
                value={value.input}
                onChange={(input: Json) =>
                  onChange({ ...value, input, captured: undefined })
                }
                onValidityChange={(valid) =>
                  onValidityChange(`${own}.input`, valid)
                }
              />
            )}
            {value.captured && (
              <p className={styles.hint}>
                Copied from run{' '}
                <code className={styles.mono}>
                  {value.captured.runId.slice(0, 8)}
                </code>
                . Editing the input saves it as entered.
              </p>
            )}
            {problems.get(prefix) && (
              <p className={styles.fieldError}>{problems.get(prefix)}</p>
            )}
          </div>
        )}
        <div>
          <h4 className={styles.subheading}>Checks</h4>
          <CheckFields
            checks={value.assertions}
            keys={value.checkKeys}
            onChange={(assertions, checkKeys) =>
              onChange({ ...value, assertions, checkKeys })
            }
            targets={checkTargets(workflow.draft)}
            problems={problems}
            prefix={`${prefix}.assertions`}
            validityPrefix={`${own}.assertions`}
            onValidityChange={onValidityChange}
          />
        </div>
        <div>
          <h4 className={styles.subheading}>Simulation fixtures</h4>
          <p className={styles.hint}>
            Ordered step outcomes that a simulation substitutes for Agent,
            Script, Fetch, Wait, Human input and Workflow steps. Live
            comparisons ignore them.
          </p>
          <JsonEditor
            label="Fixtures"
            rows={
              Array.isArray(value.fixtures) && value.fixtures.length ? 8 : 3
            }
            value={value.fixtures ?? []}
            validate={fixtureProblem}
            onValidityChange={(valid) =>
              onValidityChange(`${own}.fixtures`, valid)
            }
            onChange={(fixtures: Json) =>
              onChange({
                ...value,
                fixtures:
                  value.fixtures === undefined &&
                  Array.isArray(fixtures) &&
                  !fixtures.length
                    ? undefined
                    : fixtures,
              })
            }
          />
          {problems.get(`${prefix}.fixtures`) && (
            <p className={styles.fieldError}>
              {problems.get(`${prefix}.fixtures`)}
            </p>
          )}
        </div>
        <Textarea
          label="Quality guidance"
          description="What a reviewer should judge in live comparisons. Simulations ignore it."
          autosize
          minRows={2}
          maxRows={10}
          maxLength={4000}
          value={value.qualityGuidance}
          onChange={(e) =>
            onChange({ ...value, qualityGuidance: e.target.value })
          }
        />
      </Stack>
    </section>
  );
}

export function SuiteEditor({
  workflow,
  suite,
}: {
  workflow: Workflow;
  suite?: TestSuite;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [baseline, setBaseline] = useState(suite);
  const [draft, setDraft] = useState<SuiteDraft>(() =>
    suite ? suiteDraft(suite) : emptySuite(),
  );
  const [savedDraft, setSavedDraft] = useState(draft);
  const existing = useRef<Set<string>>(undefined);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<SuiteDraft>();
  const [loadingLatest, setLoadingLatest] = useState(false);
  const dirty = !sameSuiteDraft(draft, savedDraft);
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const busy = saving || loadingLatest;
  const conflict = Boolean(
    baseline &&
    !unconfirmed &&
    (saveError === suiteConflict ||
      (dirty && suite && suite.revision > baseline.revision)),
  );
  const allProblems = suiteProblems(draft);
  const problems = submitted ? allProblems : new Map<string, string>();
  const general = submitted
    ? [allProblems.get(''), allProblems.get('cases')].filter(Boolean).join(' ')
    : '';
  const back = () =>
    void navigate(
      baseline
        ? paths.testSuite(workflow.id, baseline.id)
        : paths.workflowTests(workflow.id),
    );

  // Take a newer saved revision while the form is unchanged.
  useEffect(() => {
    if (
      !dirty &&
      !busy &&
      !unconfirmed &&
      suite &&
      baseline &&
      suite.revision > baseline.revision
    ) {
      setBaseline(suite);
      const next = suiteDraft(suite);
      setDraft(next);
      setSavedDraft(next);
    }
  }, [dirty, busy, unconfirmed, suite, baseline]);

  const setValidity = (key: string, valid: boolean) =>
    setInvalid((current) => {
      const next = new Set(current);
      if (!valid) next.add(key);
      else
        for (const item of current)
          if (item === key || item.startsWith(`${key}.`)) next.delete(item);
      return next.size === current.size &&
        [...next].every((k) => current.has(k))
        ? current
        : next;
    });

  const accept = (result: TestSuite) => {
    client.setQueryData(
      trpc.testbench.suite.queryKey({ id: result.id }),
      result,
    );
    void client.invalidateQueries(trpc.testbench.suites.pathFilter());
    if (!finishSave(true)) return;
    void navigate(paths.testSuite(workflow.id, result.id), { replace: true });
  };

  const save = async () => {
    if (busy || (baseline && !dirty) || conflict || unconfirmed) return;
    if (allProblems.size || invalid.size) {
      setSubmitted(true);
      // Move focus to the first field that needs attention once errors render.
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    if (!beginSave()) return;
    setSaveError('');
    let result: TestSuite;
    try {
      if (!baseline) {
        // Creation has no request ID. Note the suites that exist now so an
        // unconfirmed create can be matched to a new suite with this content.
        const before = await api.testbench.suites.query({
          workflowId: workflow.id,
          limit: 100,
        });
        existing.current = new Set(before.items.map((item) => item.id));
      }
      const write = (content: ReturnType<typeof suiteContent>) =>
        baseline
          ? api.testbench.updateSuite.mutate({
              id: baseline.id,
              revision: baseline.revision,
              content,
            })
          : api.testbench.createSuite.mutate({
              workflowId: workflow.id,
              content,
            });
      try {
        result = await write(suiteContent(draft));
      } catch (error) {
        // A deleted source run cannot be re-read; keep its captured input.
        if (
          !isConfirmedWriteRejection(error) ||
          !/^Source run .* is missing/.test(errorMessage(error)) ||
          JSON.stringify(suiteContent(draft, false)) ===
            JSON.stringify(suiteContent(draft))
        )
          throw error;
        result = await write(suiteContent(draft, false));
      }
    } catch (error) {
      if (!finishSave(false)) return;
      const message = errorMessage(error);
      if (!isConfirmedWriteRejection(error) && message !== suiteConflict) {
        setUnconfirmed(draft);
        setSaveError(
          baseline
            ? 'Interlock could not confirm whether your changes were saved. Check the saved suite before trying again.'
            : 'Interlock could not confirm whether the suite was created. Check saved suites before creating it again.',
        );
        return;
      }
      setSaveError(message);
      return;
    }
    accept(result);
  };

  // Reconcile an unconfirmed write before offering it again.
  const check = async () => {
    if (!unconfirmed || loadingLatest) return;
    setLoadingLatest(true);
    try {
      if (baseline) {
        const latest = await api.testbench.suite.query({ id: baseline.id });
        if (sameSuiteDraft(suiteDraft(latest), unconfirmed)) {
          setUnconfirmed(undefined);
          setLoadingLatest(false);
          if (beginSave()) accept(latest);
          return;
        }
        setUnconfirmed(undefined);
        setSaveError(
          latest.revision > baseline.revision
            ? suiteConflict
            : 'Your changes were not saved. Save them again.',
        );
      } else {
        // Only a suite that did not exist before this save, with exactly the
        // submitted content, is this save's result.
        const list = await api.testbench.suites.query({
          workflowId: workflow.id,
          limit: 100,
        });
        let match: TestSuite | undefined;
        for (const item of list.items.filter(
          (item) => !existing.current?.has(item.id),
        )) {
          const candidate = await api.testbench.suite.query({ id: item.id });
          if (sameSuiteDraft(suiteDraft(candidate), unconfirmed)) {
            match = candidate;
            break;
          }
        }
        setUnconfirmed(undefined);
        if (match) {
          setLoadingLatest(false);
          if (beginSave()) {
            finishSave(true);
            void navigate(paths.testSuite(workflow.id, match.id), {
              replace: true,
            });
          }
          return;
        }
        setSaveError('The suite was not created. Create it again.');
      }
    } catch (error) {
      setSaveError(`Could not check the saved suite. ${errorMessage(error)}`);
    }
    setLoadingLatest(false);
  };

  const loadLatest = async () => {
    if (!baseline) return;
    setLoadingLatest(true);
    try {
      const latest = await api.testbench.suite.query({ id: baseline.id });
      client.setQueryData(
        trpc.testbench.suite.queryKey({ id: latest.id }),
        latest,
      );
      const next = suiteDraft(latest);
      setBaseline(latest);
      setDraft(next);
      setSavedDraft(next);
      setInvalid(new Set());
      setSubmitted(false);
      setSaveError('');
    } catch (error) {
      setSaveError(`Could not load the latest suite. ${errorMessage(error)}`);
    }
    setLoadingLatest(false);
  };
  const recovery = useDraftDismissal(dirty, busy, () => void loadLatest());

  const updateCase = (index: number, value: CaseDraft) =>
    setDraft((d) => ({
      ...d,
      cases: d.cases.map((c, i) => (i === index ? value : c)),
    }));

  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={baseline?.name ?? 'New test suite'}
        subtitle={workflow.name}
        onBack={back}
        backLabel={baseline ? 'Back to suite' : 'Back to tests'}
        busy={busy}
        status={
          baseline
            ? `${dirty ? 'Unsaved changes' : 'Saved'} · Revision ${baseline.revision}`
            : dirty
              ? 'Unsaved changes'
              : undefined
        }
        actions={
          <>
            <Button
              disabled={
                busy ||
                Boolean(unconfirmed) ||
                (baseline && !dirty && !conflict)
              }
              loading={loadingLatest && !unconfirmed}
              onClick={() => {
                if (!baseline) return back();
                if (conflict) return recovery.dismiss();
                setSaveError('');
                setSubmitted(false);
                setInvalid(new Set());
                const next = suiteDraft(baseline);
                setDraft(next);
                setSavedDraft(next);
              }}
            >
              {conflict
                ? 'Load latest'
                : baseline
                  ? 'Discard changes'
                  : 'Cancel'}
            </Button>
            {unconfirmed ? (
              <Button
                variant="primary"
                loading={loadingLatest}
                onClick={() => void check()}
              >
                {baseline ? 'Check saved suite' : 'Check saved suites'}
              </Button>
            ) : (
              <Button
                form={formId}
                type="submit"
                variant="primary"
                disabled={busy || (baseline && !dirty) || conflict}
                loading={saving}
                leftSection={
                  baseline ? <Save size={16} aria-hidden="true" /> : undefined
                }
              >
                {baseline ? 'Save changes' : 'Create suite'}
              </Button>
            )}
          </>
        }
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          <form
            id={formId}
            ref={formRef}
            className={workspacePage.card}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ActionError
              message={
                conflict
                  ? 'This suite changed elsewhere. Your edits are still here.'
                  : saveError
              }
            />
            {submitted && (allProblems.size > 0 || invalid.size > 0) && (
              <p className={styles.formError} role="status">
                {general || 'Correct the highlighted fields before saving.'}
              </p>
            )}
            <fieldset disabled={busy} className={styles.fields}>
              <Stack gap="md">
                <TextInput
                  label="Name"
                  required
                  maxLength={120}
                  value={draft.name}
                  error={problems.get('name')}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                />
                <Textarea
                  label="Description"
                  autosize
                  minRows={2}
                  maxRows={8}
                  maxLength={4000}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </Stack>
              <div className={workspacePage.section}>
                <h2>
                  Cases{' '}
                  <span className={styles.count}>{draft.cases.length}</span>
                </h2>
                <div className={styles.cases}>
                  {draft.cases.map((c, index) => (
                    <CaseFields
                      key={c.key}
                      value={c}
                      index={index}
                      workflow={workflow}
                      problems={problems}
                      canRemove={draft.cases.length > 1}
                      onChange={(value) => updateCase(index, value)}
                      onValidityChange={setValidity}
                      onRemove={() => {
                        setValidity(c.key, true);
                        setDraft((d) => ({
                          ...d,
                          cases: d.cases.filter((_, i) => i !== index),
                        }));
                      }}
                    />
                  ))}
                </div>
                <Button
                  mt="md"
                  disabled={draft.cases.length >= 25}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      cases: [...d.cases, emptyCase(d.cases)],
                    }))
                  }
                >
                  <Plus size={14} aria-hidden="true" /> Add case
                </Button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
      {recovery.confirmation}
    </section>
  );
}
