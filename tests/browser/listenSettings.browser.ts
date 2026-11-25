import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankDefinition } from '@interlock/core';
import { resolveDataPaths } from '@interlock/core/dataPaths';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { developmentConnection } from '../../packages/server/src/connection';
import { startServer } from '../../packages/server/src/start';
import { paths } from '../../packages/ui/src/routes/paths';

const publicUrl =
  'https://interlock-connection-fixture.tools.example.test:8443';
const runTitle = 'Connection handoff fixture';
let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function fixture(options: { hostname?: string; publicUrl?: string }) {
  const directory = await mkdtemp(join(tmpdir(), 'interlock-listen-ui-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const handle = await startServer({
    ...options,
    paths: resolveDataPaths({ env: { INTERLOCK_DATA_DIR: directory } }),
    workdir: directory,
    ui: 'packages/ui/dist',
    port: 0,
    connection: developmentConnection(),
    handleSignals: false,
  }).finally(() => log.mockRestore());
  const internalUrl = handle.connection.env?.INTERLOCK_URL;
  if (!internalUrl) throw new Error('Missing fixture connection URL');
  const landing = new URL(internalUrl);
  if (handle.connection.requireToken && handle.connection.token)
    landing.searchParams.set('token', handle.connection.token);
  const { engine } = handle;
  const workflow = engine.create('Agent handoff', '', blankDefinition());
  engine.publish(workflow.id);
  const run = engine.startSummary(workflow.id, {}, undefined, 1, undefined, {
    title: runTitle,
  });
  return {
    landing: landing.href,
    internalUrl,
    runId: run.runId,
    async close() {
      await handle.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const clipboard = (page: Page) =>
  page.evaluate(() => navigator.clipboard.readText());

it.each([1440, 820, 390])(
  'checks Diagnostics and copies the configured endpoint at %dpx',
  async (width) => {
    const app = await fixture({ publicUrl });
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(app.landing);
      await page.getByRole('link', { name: 'Diagnostics' }).click();
      const runChecks = page.getByRole('button', { name: 'Run checks' });
      await page.getByText('127.0.0.1 (default)', { exact: true }).waitFor();
      await page
        .getByText(`${publicUrl} (startup option)`, { exact: true })
        .waitFor();
      await page.route(
        (url) => url.pathname === '/trpc/system.doctor',
        (route) => route.abort(),
      );
      await runChecks.click();
      await page.getByText('Showing the last successful report.').waitFor();
      await page
        .getByText(`${publicUrl} (startup option)`, { exact: true })
        .waitFor();
      await page.unrouteAll();
      await runChecks.click();
      await page.getByText('Diagnostics failed').waitFor({ state: 'hidden' });
      const evidence = process.env.INTERLOCK_UI_EVIDENCE_DIR;
      if (evidence && width !== 820) {
        await page
          .getByText('requireToken', { exact: true })
          .evaluate((row) => row.scrollIntoView({ block: 'center' }));
        await page.screenshot({
          path: join(evidence, `diagnostics-${width}.png`),
          animations: 'disabled',
        });
      }

      await page.getByRole('link', { name: /^Runs\b/ }).click();
      await page.getByRole('link', { name: runTitle, exact: true }).click();
      await page
        .getByRole('button', { name: 'Copy instructions for agent' })
        .click();
      await page.getByRole('button', { name: 'Instructions copied' }).waitFor();
      expect((await clipboard(page)).split('\n').slice(0, 2)).toEqual([
        `Continue existing Interlock run ${app.runId}. Do not start a new run.`,
        `Connect to Interlock MCP at ${publicUrl}/mcp.`,
      ]);
      const connect = page.getByRole('button', { name: 'Connect an agent' });
      await connect.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Connect with MCP' });
      await dialog.getByRole('tab', { name: 'Other' }).click();
      await dialog.getByRole('button', { name: 'Copy endpoint URL' }).click();
      await dialog.getByRole('button', { name: 'Copied' }).waitFor();
      expect(await clipboard(page)).toBe(`${publicUrl}/mcp`);
      if (evidence && width !== 820)
        await page.screenshot({
          path: join(evidence, `connect-${width}.png`),
          animations: 'disabled',
          mask: [dialog.getByText(/^Authorization: Bearer /)],
          maskColor: '#292929',
        });
      await dialog.getByText('Legacy stdio', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Copy configuration' }).click();
      await dialog.getByRole('button', { name: 'Copied' }).waitFor();
      expect(JSON.parse(await clipboard(page))).toMatchObject({
        env: { INTERLOCK_URL: app.internalUrl },
      });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await expect
        .poll(() =>
          connect.evaluate((button) => button === document.activeElement),
        )
        .toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    } finally {
      await context.close();
      await app.close();
    }
  },
);

it.each([{}, { hostname: '0.0.0.0' }, { publicUrl }])(
  'keeps run copy usable without an advertised endpoint (%j)',
  async (options) => {
    const app = await fixture(options);
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      let allowFailure!: () => void;
      const failConnection = new Promise<void>((resolve) => {
        allowFailure = resolve;
      });
      if (options.publicUrl) {
        await page.route(
          (url) =>
            url.pathname
              .slice('/trpc/'.length)
              .split(',')
              .includes('connection'),
          async (route) => {
            await failConnection;
            await route.abort();
          },
        );
      }
      await page.goto(app.landing);
      if (!options.publicUrl) {
        await page.getByRole('link', { name: 'Diagnostics' }).click();
        await page.getByText('Not set (default)', { exact: true }).waitFor();
      }
      await page.goto(app.internalUrl + paths.run(app.runId));
      await page
        .getByRole('button', { name: 'Copy instructions for agent' })
        .click();
      await page.getByRole('button', { name: 'Instructions copied' }).waitFor();
      const original = await clipboard(page);
      expect(original).toMatch(
        /^Continue existing Interlock run .*?\. Do not start a new run\.\nResume with get_run_briefing/,
      );
      expect(original).not.toContain('/mcp');
      if (options.publicUrl) {
        await page.getByRole('button', { name: 'Connect an agent' }).click();
        const dialog = page.getByRole('dialog', { name: 'Connect with MCP' });
        await dialog
          .getByRole('status')
          .filter({ hasText: 'Loading configuration…' })
          .waitFor();
        expect(
          await dialog
            .getByRole('button', { name: 'Copy configuration' })
            .isDisabled(),
        ).toBe(true);
        allowFailure();
        await dialog.getByRole('alert').waitFor();
        await dialog
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        await page.getByText('Engine unavailable', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Instructions copied' }).click();
        expect(await clipboard(page)).toBe(original);
      }
    } finally {
      await context.close();
      await app.close();
    }
  },
);
