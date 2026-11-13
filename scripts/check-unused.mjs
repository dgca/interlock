// Runs Knip and compares its findings with knip-baseline.json.
// Fails on findings missing from the baseline and on baseline entries that
// no longer occur, so the baseline can only shrink.
// `--update` removes stale entries from the baseline. It refuses to add new
// findings unless `--allow-new` is also passed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselinePath = fileURLToPath(
  new URL('../knip-baseline.json', import.meta.url),
);
const update = process.argv.includes('--update');
const allowNew = process.argv.includes('--allow-new');
const started = performance.now();

const knip = spawnSync(
  fileURLToPath(new URL('../node_modules/.bin/knip', import.meta.url)),
  ['--reporter', 'json', '--no-exit-code', '--no-progress'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (knip.error) throw knip.error;
if (knip.status !== 0) {
  process.stderr.write(knip.stderr);
  console.error(`knip exited with status ${knip.status}`);
  process.exit(1);
}

const report = JSON.parse(knip.stdout);
if (!Array.isArray(report.issues)) {
  console.error('Unrecognised Knip JSON report: missing issues array.');
  process.exit(1);
}

function symbolName(item) {
  // Duplicate exports are reported as a group of aliases.
  if (Array.isArray(item)) return item.map(symbolName).join('|');
  if (item && typeof item.name === 'string') return item.name;
  throw new Error(`Unrecognised Knip issue entry: ${JSON.stringify(item)}`);
}

// Knip issue types, as named in its JSON reporter. Listed explicitly so that
// other array fields, such as `owners` from a CODEOWNERS file, are not
// mistaken for findings.
const issueTypes = [
  'binaries',
  'catalog',
  'catalogReferences',
  'cycles',
  'dependencies',
  'devDependencies',
  'duplicates',
  'enumMembers',
  'exports',
  'files',
  'namespaceMembers',
  'nsExports',
  'nsTypes',
  'optionalPeerDependencies',
  'subpaths',
  'types',
  'unlisted',
  'unresolved',
];

// Fail rather than silently skip issue types added by a newer Knip.
const knownFields = new Set(['file', 'owners', ...issueTypes]);
for (const field of new Set(report.issues.flatMap(Object.keys))) {
  if (!knownFields.has(field)) {
    console.error(`Unrecognised Knip issue type: ${field}`);
    process.exit(1);
  }
}

const key = (finding) => `${finding.file} ${finding.type} ${finding.symbol}`;
const findings = report.issues
  .flatMap((issue) =>
    issueTypes.flatMap((type) =>
      (issue[type] ?? []).map((item) => ({
        file: issue.file,
        type,
        symbol: symbolName(item),
      })),
    ),
  )
  .sort((a, b) => key(a).localeCompare(key(b)));

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8')).findings
  : [];
const baselineKeys = new Set(baseline.map(key));
const currentKeys = new Set(findings.map(key));
const added = findings.filter((finding) => !baselineKeys.has(key(finding)));
const stale = baseline.filter((finding) => !currentKeys.has(key(finding)));
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const describe = (finding) =>
  `${finding.type}: ${finding.file}: ${finding.symbol}`;

if (update) {
  if (added.length && !allowNew) {
    for (const finding of added) console.error(`New ${describe(finding)}`);
    console.error(
      '\nRefusing to add new findings to knip-baseline.json. Remove the ' +
        'unused code, or pass --allow-new to baseline it deliberately.',
    );
    process.exit(1);
  }
  writeFileSync(baselinePath, `${JSON.stringify({ findings }, null, 2)}\n`);
  for (const finding of added) console.log(`Added ${describe(finding)}`);
  for (const finding of stale) console.log(`Removed ${describe(finding)}`);
  console.log(
    `Wrote ${findings.length} findings to knip-baseline.json ` +
      `(${added.length} added, ${stale.length} removed).`,
  );
  process.exit(0);
}

for (const finding of added) {
  console.error(`New ${describe(finding)}`);
}
for (const finding of stale) {
  console.error(`Stale baseline entry ${describe(finding)}`);
}
if (added.length || stale.length) {
  console.error(
    '\nRemove new unused code, or configure its entry point in knip.json. ' +
      'After fixing a baselined finding, run `pnpm lint:unused --update`.',
  );
  process.exit(1);
}
console.log(
  `No new unused files, exports or dependencies (${baseline.length} baselined, ${seconds}s).`,
);
