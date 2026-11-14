import {
  LoadingSkeleton,
  Placeholder,
  Stack,
  workspacePage,
} from '../../design-system';
import styles from './Memory.module.css';

/** Memory section loading: toolbar and note cards keep their loaded geometry. */
export function MemoryViewSkeleton() {
  return (
    <div className={workspacePage.page}>
      <div className={workspacePage.toolbar} aria-hidden="true">
        <Placeholder h={12} w={180} />
        <div className={workspacePage.filters}>
          <Placeholder h={40} w={110} />
        </div>
      </div>
      <div className={workspacePage.content}>
        <LoadingSkeleton label="Loading memory…" className={styles.content}>
          {[0, 1].map((section) => (
            <div key={section} className={styles.section}>
              <Placeholder h={18} w={160} />
              {[0, 1].map((note) => (
                <div key={note} className={styles.note}>
                  <Stack gap="xs">
                    <Placeholder h={12} w="85%" />
                    <Placeholder h={12} w="60%" />
                  </Stack>
                  <Placeholder h={10} w={200} />
                </div>
              ))}
            </div>
          ))}
        </LoadingSkeleton>
      </div>
    </div>
  );
}
