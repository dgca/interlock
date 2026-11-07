async (page) => {
  page.setDefaultTimeout(5000);
  const checks = [];
  const assert = (ok, name) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
  const visit = async (q = '') => {
    await page.goto('http://127.0.0.1:5196/' + q);
    await page.getByRole('heading', { name: /Schedules/ }).waitFor();
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit();
  await page.getByRole('button', { name: 'Add schedule', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  assert(
    await page.getByText('Enter a schedule name.').isVisible(),
    'Blank name rejected beside field',
  );
  await page
    .getByRole('textbox', { name: 'Schedule name' })
    .fill('Nightly heartbeat');
  await page.getByRole('textbox', { name: 'Every', exact: true }).fill('1');
  await page.getByRole('combobox', { name: 'Unit', exact: true }).click();
  await page.getByRole('option', { name: 'seconds', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  assert(
    await page.getByText('Use an interval of at least 30 seconds.').isVisible(),
    'Interval under 30 seconds rejected',
  );
  await page.getByRole('textbox', { name: 'Every', exact: true }).fill('30');
  await page.getByRole('button', { name: 'Run input', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Input template (JSON)' })
    .fill('{broken');
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  assert(
    await page.getByText('Enter valid JSON.').isVisible(),
    'Malformed input remains visible with validation',
  );
  await page
    .getByRole('textbox', { name: 'Input template (JSON)' })
    .fill('{"mode":"nightly"}');
  await page
    .getByRole('checkbox', { name: 'scheduledAt', exact: true })
    .check();
  assert(
    (await page
      .getByRole('textbox', { name: 'scheduledAt destination path' })
      .inputValue()) === 'schedule.scheduledAt',
    'Metadata binding has explicit destination',
  );
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  await page
    .getByText('Schedule saved disabled. Enable it when you are ready.')
    .waitFor();
  assert(
    await page
      .getByRole('heading', { name: 'Nightly heartbeat', exact: true })
      .isVisible(),
    'Create saves disabled and selects new schedule',
  );
  await page
    .getByRole('button', { name: 'Enable schedule', exact: true })
    .click();
  assert(
    await page
      .getByRole('dialog')
      .getByText('sch_new', { exact: true })
      .isVisible(),
    'Enable confirmation identifies exact schedule',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Enable schedule', exact: true })
    .click();
  await page.getByText('Nightly heartbeat enabled.').waitFor();
  await page
    .getByRole('button', { name: 'Disable schedule', exact: true })
    .click();
  assert(
    await page
      .getByText('Future fires stop. Existing active or queued runs continue.')
      .isVisible(),
    'Disable consequence preserves existing runs',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Disable schedule', exact: true })
    .click();
  await page
    .getByText('Nightly heartbeat disabled. Existing runs continue.')
    .waitFor();
  await page
    .getByRole('button', { name: 'Delete schedule', exact: true })
    .click();
  assert(
    await page
      .getByRole('dialog')
      .getByText('sch_new', { exact: true })
      .isVisible(),
    'Delete confirmation identifies exact schedule',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete schedule', exact: true })
    .click();
  await page
    .getByText('Deleted Nightly heartbeat. Existing runs were kept.')
    .waitFor();
  assert(
    await page
      .getByRole('heading', { name: 'Schedules 2', exact: true })
      .isVisible(),
    'Delete removes only selected schedule',
  );
  await page.locator('.fixtures summary').click();
  await page
    .getByRole('checkbox', { name: 'Reject next mutation', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Edit schedule', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Schedule name' })
    .fill('Retained after failure');
  await page
    .getByRole('button', { name: 'Save schedule', exact: true })
    .click();
  await page
    .getByText(
      'Schedule was not saved. Your edits are still here. Retry when the engine is available.',
    )
    .waitFor();
  assert(
    (await page
      .getByRole('textbox', { name: 'Schedule name' })
      .inputValue()) === 'Retained after failure',
    'Rejected save retains local edits',
  );
  await page.screenshot({
    path: '.tasks/issue-236/ui/evidence/save-failure-1440.png',
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(
    await page
      .getByRole('button', { name: 'Edit schedule', exact: true })
      .evaluate((el) => el === document.activeElement),
    'Cancel restores focus to Edit schedule',
  );
  await page
    .getByRole('checkbox', { name: 'Reject next mutation', exact: true })
    .uncheck();
  await page
    .getByRole('checkbox', { name: 'Fail refresh after success', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Disable schedule', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Disable schedule', exact: true })
    .click();
  await page
    .getByText(
      'Change recorded, but inspection could not refresh. Retry refresh to see current fire status.',
    )
    .waitFor();
  assert(
    await page
      .getByRole('button', { name: 'Retry refresh', exact: true })
      .isVisible(),
    'Acknowledged mutation survives failed refresh',
  );
  assert(
    (await page.getByRole('dialog').count()) === 0,
    'Acknowledged mutation dialog closes despite refresh failure',
  );
  await page
    .getByRole('button', { name: 'Retry refresh', exact: true })
    .click();
  assert(
    await page.getByText('Inspection refreshed.').isVisible(),
    'Read-only refresh recovery works',
  );
  await visit('?state=paused');
  await page.getByRole('button', { name: /Weekday triage Disabled/ }).click();
  await page
    .getByRole('button', { name: 'Enable schedule', exact: true })
    .click();
  assert(
    await page
      .getByText(
        'Two workflow pause holds still block starts. Enabling this schedule does not release those holds.',
      )
      .isVisible(),
    'Enable does not release workflow holds',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Enable schedule', exact: true })
    .click();
  await page
    .getByText('Weekday triage enabled. Workflow pauses still block fires.')
    .waitFor();
  assert(
    await page.getByText('Workflow paused · 2 holds').isVisible(),
    'Workflow holds remain after enable',
  );
  await visit('?state=attention');
  await page.locator('aside nav').getByRole('link', { name: /Runs/ }).click();
  assert(
    await page
      .getByRole('tab', { name: 'Needs attention 1', exact: true })
      .isVisible(),
    'Schedule attention available through Runs navigation',
  );
  await page.screenshot({
    path: '.tasks/issue-236/ui/evidence/needs-attention-1440.png',
  });
  await page
    .getByRole('button', { name: 'Inspect schedule', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Re-enable schedule', exact: true })
    .first()
    .click();
  assert(
    await page
      .getByText(
        'Re-enabling clears this schedule’s automatic pause. Review the cause of its 3 consecutive failures first.',
      )
      .isVisible(),
    'Auto-pause recovery explains consequence',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Re-enable schedule', exact: true })
    .click();
  await page.getByText('Intake heartbeat enabled.').waitFor();
  assert(
    (await page
      .getByText('Automatically paused after 3 consecutive failures', {
        exact: true,
      })
      .count()) === 0,
    'Re-enable resolves automatic pause',
  );
  await visit('?state=draft');
  await page
    .getByRole('button', { name: 'Add schedule', exact: true })
    .first()
    .click();
  await page
    .getByRole('textbox', { name: 'Schedule name' })
    .fill('Draft heartbeat');
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Draft heartbeat', exact: true })
    .waitFor();
  assert(
    await page
      .getByRole('button', { name: 'Enable schedule', exact: true })
      .isDisabled(),
    'Draft workflow permits disabled save and blocks enable',
  );
  await visit('?state=error');
  await page
    .getByRole('button', { name: 'Retry loading', exact: true })
    .click();
  assert(
    await page
      .getByRole('button', { name: 'Edit schedule', exact: true })
      .isVisible(),
    'Load error has working retry',
  );
  await visit('?state=missing');
  assert(
    await page
      .getByText(
        'No fire history yet. Last fire and lag will appear after the first attempt.',
      )
      .isVisible(),
    'Never-fired schedule has explicit missing-data state',
  );
  await visit('?state=lag');
  assert(
    await page.getByText('Schedule is behind by 4m 12s').isVisible(),
    'Excessive lag remains visibly enabled',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await visit();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    'Phone document has no horizontal overflow',
  );
  await page
    .getByRole('button', { name: 'Edit schedule', exact: true })
    .click();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    'Phone modal has no horizontal overflow',
  );
  const footer = await page.locator('[data-modal-footer]').boundingBox();
  assert(
    footer && footer.y + footer.height <= 844,
    'Phone modal footer remains visible',
  );
  await page.getByRole('button', { name: 'Policies', exact: true }).click();
  await page
    .getByRole('radio', { name: 'Allow another run', exact: true })
    .check();
  assert(
    await page
      .getByRole('radio', { name: 'Allow another run', exact: true })
      .isChecked(),
    'Phone policy radios work',
  );
  await page
    .getByRole('button', { name: 'Save schedule', exact: true })
    .click();
  await page
    .getByText('Schedule saved. Changes apply to future fires.')
    .waitFor();
  return {
    status: 'passed',
    checks,
    viewports: [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ],
    scope:
      'Fixture UI interactions only. No scheduler, real mutations, or cron calculation tested.',
  };
};
