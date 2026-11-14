import { Link } from 'react-router';
import type { ApprovalsReport } from '@interlock/core';
import { Table, Text, Title, workspacePage } from '../../design-system';
import { paths } from '../../routes/paths';

/** Managed Agent permission requests per run: asked of a person or allowed by policy. */
export function ReportApprovals({ approvals }: { approvals: ApprovalsReport }) {
  return (
    <section className={workspacePage.card} aria-label="Permission approvals">
      <Title order={2} size="h4" mb="xs">
        Permission approvals
      </Title>
      <Text size="xs" c="dimmed" mb="sm">
        {approvals.prompted} asked a person · {approvals.autoAllowed} allowed by
        the workflow permission policy
      </Text>
      <Table.ScrollContainer minWidth={520}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Run</Table.Th>
              <Table.Th>Asked</Table.Th>
              <Table.Th>Allowed by policy</Table.Th>
              <Table.Th>Policy not applied</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {approvals.byRun.map((run) => (
              <Table.Tr key={run.runId}>
                <Table.Td>
                  <Link to={paths.run(run.runId)}>{run.runId.slice(0, 8)}</Link>
                </Table.Td>
                <Table.Td>{run.prompted}</Table.Td>
                <Table.Td>{run.autoAllowed}</Table.Td>
                <Table.Td>{run.notApplied?.join('; ') ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </section>
  );
}
