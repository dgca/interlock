import { NativeSelect } from '../../design-system';

import { useState } from 'react';

import type { ExecutorModels, SavedModelAlias } from '@interlock/core';
import { ModelPicker } from './ModelPicker';

/** Model and effort share discovery so choices always describe the effective model. */
export function ModelSettings({
  label,
  defaultLabel,
  effortDefaultLabel,
  model,
  effort,
  inheritedModel,
  inheritedEffort,
  onModelChange,
  onEffortChange,
  profileId,
  paths,
  disabled = false,
  canResetEffort = true,
  modelHint,
  allowAliases = false,
}: {
  label: string;
  defaultLabel: string;
  effortDefaultLabel: string;
  model?: string;
  effort?: string | null;
  inheritedModel?: string;
  inheritedEffort?: string | null;
  onModelChange: (value: string | undefined) => void;
  onEffortChange: (value: string | null | undefined) => void;
  profileId?: string;
  paths?: { command?: string; cwd?: string };
  disabled?: boolean;
  canResetEffort?: boolean;
  modelHint?: string;
  allowAliases?: boolean;
}) {
  const [catalog, setCatalog] = useState<ExecutorModels>();
  const [alias, setAlias] = useState<SavedModelAlias | null>();
  const effectiveModel = model ?? inheritedModel;
  const effectiveEffort = effort === undefined ? inheritedEffort : effort;
  const levels = catalog?.models.find(
    (m) => m.id === effectiveModel,
  )?.effortLevels;
  const invalid =
    !alias &&
    (!allowAliases || alias === null) &&
    !!effectiveEffort &&
    (!effectiveModel || (!!catalog && !levels?.includes(effectiveEffort)));
  const current =
    effort == null
      ? effort === null && canResetEffort
        ? '__native'
        : '__inherit'
      : effort;
  return (
    <div>
      <ModelPicker
        label={label}
        defaultLabel={defaultLabel}
        value={model}
        onChange={onModelChange}
        profileId={profileId}
        paths={paths}
        disabled={disabled}
        onCatalog={setCatalog}
        loadCapabilities={!!effectiveModel}
        allowAliases={allowAliases}
        inheritedValue={inheritedModel}
        onAlias={setAlias}
      />
      {alias ? (
        <p className="hint">
          {model ? 'Uses' : 'Inherits'} model alias {alias.name}. Its candidates
          can choose their own harness and thinking effort.
        </p>
      ) : (
        modelHint && <p className="hint">{modelHint}</p>
      )}
      {(!alias || effort !== undefined) &&
        (effectiveModel ||
          effort !== undefined ||
          inheritedEffort !== undefined) && (
          <NativeSelect
            mt="md"
            label="Thinking effort"
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            disabled={disabled}
            value={current}
            onChange={(e) =>
              onEffortChange(
                e.currentTarget.value === '__inherit'
                  ? undefined
                  : e.currentTarget.value === '__native'
                    ? null
                    : e.currentTarget.value,
              )
            }
            data={[
              { value: '__inherit', label: effortDefaultLabel },
              ...(canResetEffort
                ? [{ value: '__native', label: 'Use native default' }]
                : []),
              ...(levels ?? []).map((value) => ({
                value,
                label:
                  value === 'xhigh'
                    ? 'Extra high'
                    : value.charAt(0).toUpperCase() + value.slice(1),
              })),
              ...(typeof effort === 'string' && !levels?.includes(effort)
                ? [
                    {
                      value: effort,
                      label: `${effort}${!alias && catalog ? ' · unavailable' : ''}`,
                    },
                  ]
                : []),
            ]}
            error={
              invalid
                ? !effectiveModel
                  ? 'Select a model or use native default for thinking effort.'
                  : catalog?.status === 'unavailable'
                    ? 'Thinking effort could not be verified. Refresh models or use native default.'
                    : `Thinking effort ${effectiveEffort} is not reported for ${effectiveModel}. Choose a supported level or use native default.`
                : undefined
            }
            description={
              alias
                ? 'Alias candidate effort settings take precedence over this override.'
                : !effectiveModel
                  ? 'Choose a model to discover its supported effort levels.'
                  : !profileId
                    ? 'Select a harness to discover supported effort levels.'
                    : !catalog
                      ? 'Checking supported effort levels…'
                      : catalog.status === 'unavailable'
                        ? 'Effort choices could not be loaded. Refresh models to try again.'
                        : !levels?.length
                          ? 'No effort choices reported for this model. Native defaults remain available.'
                          : effectiveEffort
                            ? `Effective effort: ${effectiveEffort}${effort === undefined ? ' · inherited' : ''}.`
                            : 'Uses the native harness’s effort setting.'
            }
          />
        )}
    </div>
  );
}
