import {
  ActionIcon,
  Combobox,
  TextInput,
  useCombobox,
} from '../../design-system';
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import {
  workflowStageColumn,
  workflowStageId,
  type WorkflowBoard,
  type WorkflowNode,
} from '@interlock/core';

export function StageInput({
  node,
  board,
  previousBoard,
  boardStageColumns,
  onChange,
}: {
  node: WorkflowNode;
  board?: WorkflowBoard;
  previousBoard?: WorkflowBoard;
  boardStageColumns?: Record<string, string | null>;
  onChange: (
    stage: string | undefined,
    boardColumnId: string | undefined,
  ) => void;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const [typing, setTyping] = useState(false);
  const hasColumns = Boolean(board?.columns.length);
  const stageId = workflowStageId(node);
  const mapped = Boolean(
    stageId && Object.hasOwn(boardStageColumns ?? {}, stageId),
  );
  const columnId = workflowStageColumn(node, boardStageColumns);
  const bound = (mapped ? board : previousBoard)?.columns.find(
    (column) => column.id === columnId,
  );
  const value = mapped
    ? (node.stage ?? bound?.name ?? '')
    : (bound?.name ?? node.stage ?? '');
  const canClear = Boolean(value || stageId);
  const columns = typing
    ? board?.columns.filter((column) =>
        column.name
          .toLocaleLowerCase()
          .includes(value.trim().toLocaleLowerCase()),
      )
    : board?.columns;
  const description =
    mapped && bound && board
      ? `Maps to ${bound.name} on ${board.name}.`
      : bound
        ? `${previousBoard?.name} board column`
        : node.stageId || mapped
          ? 'Portable stage without a local board column.'
          : board
            ? `Choose a ${board.name} column or type a custom stage.`
            : 'Optional stage label for run summaries.';
  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(id) => {
        const column = board?.columns.find((item) => item.id === id);
        if (!column) return;
        onChange(column.name, id);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target
        withAriaAttributes={hasColumns}
        withExpandedAttribute={hasColumns}
        withKeyboardNavigation={hasColumns}
      >
        <TextInput
          role={hasColumns ? 'combobox' : undefined}
          aria-autocomplete={hasColumns ? 'list' : undefined}
          label="Stage"
          mb="md"
          description={description}
          value={value}
          rightSectionPointerEvents={canClear ? 'all' : 'none'}
          maxLength={200}
          onFocus={() => {
            setTyping(false);
            if (board?.columns.length) combobox.openDropdown();
          }}
          onClick={() => {
            if (board?.columns.length) combobox.openDropdown();
          }}
          onBlur={() => {
            setTyping(false);
            combobox.closeDropdown();
          }}
          onChange={(event) => {
            setTyping(true);
            const stage = event.currentTarget.value;
            onChange(stage.trim() ? stage : undefined, undefined);
            if (board?.columns.length) combobox.openDropdown();
            combobox.resetSelectedOption();
          }}
          rightSection={
            canClear ? (
              <ActionIcon
                variant="subtle"
                aria-label="Clear stage"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(undefined, undefined);
                  combobox.closeDropdown();
                }}
              >
                <X size={15} />
              </ActionIcon>
            ) : board?.columns.length ? (
              <ChevronDown size={16} />
            ) : undefined
          }
        />
      </Combobox.Target>
      {Boolean(columns?.length) && (
        <Combobox.Dropdown>
          <Combobox.Options>
            {columns?.map((column) => (
              <Combobox.Option
                key={column.id}
                value={column.id}
                active={column.id === columnId}
              >
                {column.name}
              </Combobox.Option>
            ))}
          </Combobox.Options>
        </Combobox.Dropdown>
      )}
    </Combobox>
  );
}
