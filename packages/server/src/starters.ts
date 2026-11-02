import sdlc from '../../../workflows/sdlc.json';
import evaluate from '../../../workflows/evaluate.json';

export interface Starter {
  /** Permanent identity. Changing a shipped starter never changes this ID. */
  id: string;
  template: { name: string; description: string; definition: unknown };
  /** The old seed marker already settled whether to deliver this starter. */
  legacySeed?: boolean;
}

// Keep this set curated. Specialized recipes remain explicit imports.
export const starters: readonly Starter[] = [
  { id: 'sdlc', template: sdlc, legacySeed: true },
  { id: 'evaluate-comparison', template: evaluate },
];

export interface StarterInstallation {
  id: string;
  outcome: 'installed' | 'recognized' | 'legacy-skipped' | 'name-collision';
  workflowId?: string;
  templateHash: string;
  recordedAt: string;
}
