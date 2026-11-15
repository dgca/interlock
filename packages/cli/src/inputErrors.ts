/**
 * Messages of a rejected input whose issues Interlock wrote itself, such as a
 * removed variable field. Other validation failures keep the full issue list.
 */
export function customInputMessages(message: string) {
  try {
    const issues: unknown = JSON.parse(message);
    if (
      Array.isArray(issues) &&
      issues.length > 0 &&
      issues.every(
        (issue: { code?: unknown; message?: unknown }) =>
          issue?.code === 'custom' && typeof issue.message === 'string',
      )
    )
      // The path tells which trigger, lane or binding failed.
      return issues
        .map((issue: { message: string; path?: unknown }) =>
          Array.isArray(issue.path) && issue.path.length
            ? `${issue.message} (at ${issue.path.join('.')})`
            : issue.message,
        )
        .join('\n');
  } catch {
    /* Not an issue list. */
  }
  return undefined;
}
