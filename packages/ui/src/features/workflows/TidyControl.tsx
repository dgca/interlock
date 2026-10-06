import { useState } from 'react';
import { Loader, Menu } from '@mantine/core';
import { ControlButton } from '@xyflow/react';
import { Check, Settings, WandSparkles } from 'lucide-react';

type Layout = 'dagre' | 'elk';
const preferenceKey = 'interlock.tidy-layout';
const layouts = { dagre: 'Dagre', elk: 'ELK' } as const;

function preferredLayout(): Layout {
  try {
    return localStorage.getItem(preferenceKey) === 'elk' ? 'elk' : 'dagre';
  } catch {
    return 'dagre';
  }
}

export function TidyControl({
  disabled,
  arranging,
  onTidy,
}: {
  disabled: boolean;
  arranging: boolean;
  onTidy: (layout: Layout) => void;
}) {
  const [layout, setLayout] = useState(preferredLayout);
  const choose = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {
      // Tidy still works when the browser cannot store preferences.
    }
  };
  return (
    <>
      <ControlButton
        aria-label="Tidy"
        disabled={disabled}
        title={
          arranging
            ? 'Arranging…'
            : `Tidy using ${layouts[layout]}. Undo to restore the previous layout.`
        }
        onClick={() => onTidy(layout)}
      >
        {arranging ? (
          <Loader size={12} color="var(--accent-text)" />
        ) : (
          <WandSparkles />
        )}
      </ControlButton>
      <Menu position="right-start" width={160}>
        <Menu.Target>
          <ControlButton
            aria-label="Tidy mode"
            title="Tidy mode"
            disabled={disabled}
          >
            <Settings style={{ fill: 'none' }} />
          </ControlButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Tidy mode</Menu.Label>
          {(Object.keys(layouts) as Layout[]).map((option) => (
            <Menu.Item
              key={option}
              disabled={disabled}
              rightSection={layout === option ? <Check size={12} /> : undefined}
              onClick={() => choose(option)}
            >
              {layouts[option]}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
