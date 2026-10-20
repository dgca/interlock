import { expect, it } from 'vitest';
import { resolveUiFeatures } from '../packages/ui/src/lib/uiFeatures';

it.each([
  undefined,
  null,
  false,
  [],
  'bad',
  { ui: null },
  { ui: { features: [] } },
])('defaults malformed or missing configuration to enabled: %j', (config) => {
  expect(resolveUiFeatures(config, '')).toEqual({
    localFileImport: true,
    connectAgent: true,
  });
});
it('resolves each feature separately with host booleans taking precedence', () => {
  expect(
    resolveUiFeatures(
      { ui: { features: { localFileImport: true, connectAgent: false } } },
      '?interlock.localFileImport=false&interlock.connectAgent=true',
    ),
  ).toEqual({ localFileImport: true, connectAgent: false });
  expect(
    resolveUiFeatures(
      { ui: { features: { localFileImport: 'true' } } },
      '?interlock.localFileImport=false',
    ),
  ).toEqual({ localFileImport: false, connectAgent: true });
});
it('accepts only exact URL booleans, ignores unknown keys, and uses the first repeated value', () => {
  expect(
    resolveUiFeatures(
      undefined,
      '?interlock.localFileImport=false&interlock.connectAgent=false',
    ),
  ).toEqual({ localFileImport: false, connectAgent: false });
  for (const value of ['true', '0', 'FALSE', '', 'no'])
    expect(
      resolveUiFeatures(
        undefined,
        `?interlock.connectAgent=${value}&unknown=false`,
      ).connectAgent,
    ).toBe(true);
  expect(
    resolveUiFeatures(
      undefined,
      '?interlock.connectAgent=true&interlock.connectAgent=false',
    ).connectAgent,
  ).toBe(true);
});
it('takes an immutable snapshot that does not track host mutations', () => {
  const config = { ui: { features: { connectAgent: false } } };
  const features = resolveUiFeatures(config, '');
  config.ui.features.connectAgent = true;
  expect(features.connectAgent).toBe(false);
  expect(Object.isFrozen(features)).toBe(true);
});
