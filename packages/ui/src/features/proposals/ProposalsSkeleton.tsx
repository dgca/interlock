import { Placeholder, workspacePage } from '../../design-system';
import { ListTableSkeleton } from '../../components/ListTable/ListTable';
import styles from './Proposals.module.css';

export const proposalTable = {
  columns: [
    { label: 'Proposal', width: '42%' },
    { label: 'Author', width: '11%' },
    { label: 'Status', width: '15%' },
    { label: 'Simulation', width: '18%' },
    { label: 'Created', width: '14%' },
  ],
  minWidth: 720,
} as const;

export function ProposalRowPlaceholder() {
  return (
    <>
      <Placeholder h={14} w="60%" />
      <Placeholder h={12} w={44} />
      <Placeholder h={20} w={64} />
      <Placeholder h={12} w={96} />
      <Placeholder h={12} w={72} />
    </>
  );
}

/** Proposals section loading: toolbar and rows keep their loaded geometry. */
export function ProposalsViewSkeleton() {
  return (
    <div className={workspacePage.page}>
      <div className={workspacePage.toolbar} aria-hidden="true">
        <div className={workspacePage.filters}>
          <Placeholder h={40} w={240} />
          <Placeholder h={40} w={170} />
        </div>
      </div>
      <div className={workspacePage.content}>
        <div className={styles.content}>
          <ListTableSkeleton {...proposalTable} label="Loading proposals…">
            <ProposalRowPlaceholder />
          </ListTableSkeleton>
        </div>
      </div>
    </div>
  );
}
