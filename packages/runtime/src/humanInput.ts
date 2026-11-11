import {
  InterlockError,
  readPath,
  type HumanInput,
  type HumanInputCapture,
  type Json,
} from '@interlock/core';

export function captureHumanInput(
  config: HumanInput,
  input: Json,
): HumanInputCapture {
  function text(path: string, field: string, max: number) {
    const value = readPath(input, path);
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw new InterlockError(
        `Human input ${field} must be nonblank text of at most ${max} characters`,
      );
    return value;
  }
  const question = config.questionPath
    ? text(config.questionPath, 'question', 4000)
    : config.question;
  const context = config.contextPath
    ? text(config.contextPath, 'context', 32000)
    : config.context;
  const evidence = config.evidence;
  return {
    question,
    context,
    answer: config.answer,
    evidence: evidence
      ? {
          title: evidence.title,
          content: text(evidence.contentPath, 'evidence', 262144),
          revision: evidence.revisionPath
            ? text(evidence.revisionPath, 'revision', 200)
            : undefined,
        }
      : undefined,
  };
}
