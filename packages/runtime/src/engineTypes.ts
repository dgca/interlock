import {
  InterlockError,
  type ModelSelection,
  type SessionIdentity,
} from '@interlock/core';

export interface Worker {
  modelSelection?: ModelSelection;
  session?: SessionIdentity;
  workerId: string;
  freshContext: boolean;
  tools: string[];
  skills: string[];
  claimTicket?: string;
}

export class ResultProcessingError extends InterlockError {
  constructor(
    readonly setting: 'routing' | 'outputBindings',
    message: string,
  ) {
    super(message);
  }
}
