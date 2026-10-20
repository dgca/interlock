import { createContext, useContext } from 'react';

export type UiFeatures = Readonly<{
  localFileImport: boolean;
  connectAgent: boolean;
}>;
const defaults: UiFeatures = Object.freeze({
  localFileImport: true,
  connectAgent: true,
});

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Resolve startup settings without coercing strings or other malformed values. */
export function resolveUiFeatures(config: unknown, search: string): UiFeatures {
  const features = record(record(record(config).ui).features);
  const params = new URLSearchParams(search);
  const enabled = (name: keyof UiFeatures) => {
    if (typeof features[name] === 'boolean') return features[name];
    const parameter = params.get(`interlock.${name}`);
    return parameter === 'false' ? false : true;
  };
  return Object.freeze({
    localFileImport: enabled('localFileImport'),
    connectAgent: enabled('connectAgent'),
  });
}

export const UiFeaturesContext = createContext<UiFeatures>(defaults);
export const useUiFeatures = () => useContext(UiFeaturesContext);
