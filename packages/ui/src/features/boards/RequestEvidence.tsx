import type { ReactNode } from 'react';
import { FileCode, FileText } from 'lucide-react';
import { Anchor, Badge, Group } from '../../design-system';
import type { Json } from '@interlock/core';
import type { api } from '../../lib/api';
import classes from './Boards.module.css';

type Detail = Awaited<ReturnType<typeof api.requests.get.query>>;
const languages = {
  javascript: 'JavaScript',
  bash: 'Bash',
  'permission-policy': 'Policy',
};

export function ReviewText({ children }: { children: string }) {
  const links =
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/gi;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of children.matchAll(links)) {
    parts.push(children.slice(cursor, match.index));
    const href = match[2] ?? match[3];
    parts.push(
      <Anchor key={match.index} href={href} target="_blank" rel="noreferrer">
        {match[1] ?? href}
      </Anchor>,
    );
    cursor = match.index + match[0].length;
  }
  parts.push(children.slice(cursor));
  return <p className={classes.reviewText}>{parts}</p>;
}

/** Outcome of an approved Script or permission policy request. */
const approvedLabel = (detail: Extract<Detail, { kind: 'scriptApproval' }>) =>
  detail.script.language === 'permission-policy'
    ? 'Policy approved'
    : 'Script approved';

/** The receipt for an accepted request. */
export function decision(detail: Detail) {
  if (detail.kind === 'human' && typeof detail.value === 'string') {
    const value =
      detail.value.length > 100
        ? detail.value.slice(0, 100) + '…'
        : detail.value;
    return `Accepted “${value}”`;
  }
  if (
    detail.kind === 'human' &&
    detail.answer.kind === 'choice' &&
    detail.value &&
    typeof detail.value === 'object' &&
    'choice' in detail.value
  ) {
    const label = detail.answer.choices.find(
      (choice) => choice.value === (detail.value as { choice: Json }).choice,
    )?.label;
    if (label === 'Approve') return 'Approved';
    if (label === 'Request changes') return 'Changes requested';
    return label ? `Answer accepted: ${label}` : 'Answer accepted';
  }
  if (detail.kind === 'permission')
    return detail.request.answer?.allow ? 'Allowed once' : 'Denied';
  if (detail.kind === 'model') return 'Replacement model recorded';
  if (detail.kind === 'recovery') return 'Stop confirmed';
  if (detail.kind === 'scriptApproval') return approvedLabel(detail);
  return 'Answer accepted';
}

/** Material a person reviews before answering: Human input evidence or Script code. */
export function RequestEvidence({ detail }: { detail: Detail }) {
  if (detail.kind === 'scriptApproval')
    return (
      <section className={classes.evidence}>
        <Group gap="xs" className={classes.evidenceHeader}>
          <FileCode size={16} aria-hidden="true" />
          <h3>{detail.script.label}</h3>
          <Badge color="gray" variant="light">
            {languages[detail.script.language]}
          </Badge>
        </Group>
        <pre tabIndex={0} aria-label={`${detail.script.label} code`}>
          {detail.script.command}
        </pre>
      </section>
    );
  if (detail.kind !== 'human' || !detail.evidence) return null;
  return (
    <section className={classes.evidence}>
      <Group gap="xs" className={classes.evidenceHeader}>
        <FileText size={16} aria-hidden="true" />
        <h3>{detail.evidence.title}</h3>
        {detail.evidence.revision && (
          <Badge color="blue" variant="light">
            {detail.evidence.revision}
          </Badge>
        )}
      </Group>
      <div
        className={classes.evidenceScroll}
        tabIndex={0}
        role="region"
        aria-label={detail.evidence.title}
      >
        <ReviewText>{detail.evidence.content}</ReviewText>
      </div>
    </section>
  );
}
