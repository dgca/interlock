import { useEffect, useRef, useState } from 'react';
import type { TestSuite } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';

const capacity = 'At most four simulations may be active';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Report = { id: string; state: string };

export type SuiteRunProgress = {
  done: number;
  total: number;
  caseId?: string;
  error?: string;
};

/**
 * Runs every case as a fixture simulation, one at a time, so a suite never
 * takes more than one of the engine's four simulation slots. Each case gets a
 * fresh request ID. A failed read stops the run; simulations already started
 * finish on the engine.
 */
export function useSuiteRun(onCaseFinished: () => void) {
  const [progress, setProgress] = useState<SuiteRunProgress>();
  const active = useRef(true);
  const busy = useRef(false);
  const finished = useRef(onCaseFinished);
  finished.current = onCaseFinished;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const run = async (suite: TestSuite, version: number) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await runCases(suite, version);
    } finally {
      busy.current = false;
    }
  };
  const runCases = async (suite: TestSuite, version: number) => {
    const total = suite.cases.length;
    for (const [done, testCase] of suite.cases.entries()) {
      if (!active.current) return;
      setProgress({ done, total, caseId: testCase.id });
      const request = {
        action: 'run' as const,
        suiteId: suite.id,
        suiteRevision: suite.revision,
        caseId: testCase.id,
        version,
        requestId: crypto.randomUUID(),
      };
      try {
        let report = (await start(request)) as Report;
        while (report.state === 'running' && active.current) {
          await wait(400);
          report = (await api.testbench.simulation.mutate({
            action: 'get',
            id: report.id,
            limit: 1,
          })) as Report;
        }
      } catch (error) {
        if (!active.current) return;
        setProgress({
          done,
          total,
          error: `Stopped at ${testCase.name}: ${errorMessage(error)}`,
        });
        finished.current();
        return;
      }
      finished.current();
    }
    if (active.current) setProgress({ done: total, total });
  };

  const running = Boolean(
    progress && !progress.error && progress.done < progress.total,
  );
  return { progress, run, running };
}

async function start(request: {
  action: 'run';
  suiteId: string;
  suiteRevision: number;
  caseId: string;
  version: number;
  requestId: string;
}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.testbench.simulation.mutate(request);
    } catch (error) {
      // Other callers can hold every slot; wait briefly for one to free up.
      if (errorMessage(error) !== capacity || attempt >= 30) throw error;
      await wait(1000);
    }
  }
}
