import { createContext, useContext, useId, type ReactNode } from 'react';
import {
  FileText,
  ArrowDownToLine,
  ArrowUpFromLine,
  Settings2,
} from 'lucide-react';
import styles from './NodeSettingsSections.module.css';
export type NodeSectionName = 'work' | 'input' | 'result' | 'execution';
const CurrentSection = createContext<NodeSectionName>('work');
export function NodeSection({
  name,
  children,
}: {
  name: NodeSectionName;
  children: ReactNode;
}) {
  const active = useContext(CurrentSection);
  return (
    <div data-node-section={name} hidden={active !== name}>
      {children}
    </div>
  );
}
export function NodeSettingsSections({
  active,
  onChange,
  workLabel,
  execution,
  boundary,
  children,
}: {
  active: NodeSectionName;
  onChange: (name: NodeSectionName) => void;
  workLabel: string;
  execution: boolean;
  boundary: boolean;
  children: ReactNode;
}) {
  const heading = useId();
  const sections = [
    { name: 'work' as const, label: workLabel, Icon: FileText },
    {
      name: 'input' as const,
      label: boundary ? 'Format' : 'Input',
      Icon: ArrowDownToLine,
    },
    ...(!boundary
      ? [{ name: 'result' as const, label: 'Result', Icon: ArrowUpFromLine }]
      : []),
    ...(execution
      ? [{ name: 'execution' as const, label: 'Execution', Icon: Settings2 }]
      : []),
  ];
  return (
    <CurrentSection.Provider value={active}>
      <div className={styles.layout}>
        <nav aria-label="Node settings" className={styles.navigation}>
          {sections.map(({ name, label, Icon }) => (
            <button
              key={name}
              type="button"
              aria-current={active === name ? 'page' : undefined}
              onClick={() => onChange(name)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <section className={styles.panel} aria-labelledby={heading}>
          <h2 id={heading}>{sections.find((s) => s.name === active)?.label}</h2>
          {children}
        </section>
      </div>
    </CurrentSection.Provider>
  );
}
