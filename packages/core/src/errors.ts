export class InterlockError extends Error {}
export class ExternalInputConflict extends InterlockError {}
/** A start that conflicts with a retained receipt or an active task; nothing was started. */
export class RunStartConflict extends InterlockError {}
export class ResultRejection extends InterlockError {
  constructor(
    readonly resultCheck: import('./resultValidation.js').ResultCheck,
    detail = '',
  ) {
    super(
      `Agent result rejected (${resultCheck.code}). No result accepted by this call. ${resultCheck.code === 'completed_conflict' ? 'A different result was already accepted. ' : resultCheck.code === 'invalid_claim' ? 'Claim token does not match. ' : ''}Claim ${resultCheck.claimUsable ? 'remains usable' : 'is not usable'}. Next: ${resultCheck.nextAction}. ${resultCheck.diagnostics.items.map((d) => `${d.path || '/'}: ${d.message}`).join(' ')} ${detail.slice(0, 2048)}`,
    );
  }
}
