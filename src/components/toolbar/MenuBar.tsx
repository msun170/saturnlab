import { useState, useRef, useEffect } from 'react';

interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  divider?: boolean;
  disabled?: boolean;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
}

function MenuDropdown({ label, items }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="menu-dropdown" ref={ref}>
      <span
        className={`menu-item ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {label}
      </span>
      {open && (
        <div className="menu-dropdown-content">
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={i} className="menu-divider" />;
            }
            return (
              <div
                key={i}
                className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
                onClick={() => {
                  if (item.disabled) return;
                  item.action?.();
                  setOpen(false);
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface MenuBarProps {
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNewNotebook: () => void;
  onCloseTab: () => void;
  onDownloadPy: () => void;
  onSaveWithoutOutputs: () => void;
  // Notebook operations (via ref)
  onCutCell: () => void;
  onCopyCell: () => void;
  onPasteCell: () => void;
  onDeleteCell: () => void;
  onUndoDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onRunCell: () => void;
  onRunAll: () => void;
  onRunAllAbove: () => void;
  onRunAllBelow: () => void;
  onChangeCellType: (type: 'code' | 'markdown') => void;
  onInterruptKernel: () => void;
  onRestartKernel: () => void;
  onRestartAndClear: () => void;
  onRestartAndRunAll: () => void;
  onToggleLineNumbers: () => void;
  onShowShortcuts: () => void;
  onShowSettings: () => void;
  fileName: string;
  hasKernel: boolean;
}

export default function MenuBar(props: MenuBarProps) {
  const fileItems: MenuItem[] = [
    { label: 'New Notebook', action: props.onNewNotebook, shortcut: '' },
    { label: 'Open...', action: props.onOpen, shortcut: 'Ctrl+O' },
    { divider: true, label: '' },
    { label: 'Save', action: props.onSave, shortcut: 'Ctrl+S' },
    { label: 'Save As...', action: props.onSaveAs },
    { label: 'Save Without Outputs', action: props.onSaveWithoutOutputs },
    { divider: true, label: '' },
    { label: 'Download as Python (.py)', action: props.onDownloadPy },
    { divider: true, label: '' },
    { label: 'Close Tab', action: props.onCloseTab },
  ];

  const editItems: MenuItem[] = [
    { label: 'Cut Cell', action: props.onCutCell, shortcut: 'Ctrl+X' },
    { label: 'Copy Cell', action: props.onCopyCell, shortcut: 'Ctrl+C' },
    { label: 'Paste Cell Below', action: props.onPasteCell, shortcut: 'Ctrl+V' },
    { label: 'Delete Cell', action: props.onDeleteCell, shortcut: 'D,D' },
    { divider: true, label: '' },
    { label: 'Undo Cell Deletion', action: props.onUndoDelete, shortcut: 'Ctrl+Z' },
  ];

  const viewItems: MenuItem[] = [
    { label: 'Toggle Line Numbers', action: props.onToggleLineNumbers, shortcut: 'L' },
  ];

  const insertItems: MenuItem[] = [
    { label: 'Insert Cell Above', action: props.onInsertAbove, shortcut: 'A' },
    { label: 'Insert Cell Below', action: props.onInsertBelow, shortcut: 'B' },
  ];

  const cellItems: MenuItem[] = [
    { label: 'Run Cell', action: props.onRunCell, shortcut: 'Shift+Enter' },
    { label: 'Run All', action: props.onRunAll, disabled: !props.hasKernel },
    { label: 'Run All Above', action: props.onRunAllAbove, disabled: !props.hasKernel },
    { label: 'Run All Below', action: props.onRunAllBelow, disabled: !props.hasKernel },
    { divider: true, label: '' },
    { label: 'Cell Type: Code', action: () => props.onChangeCellType('code'), shortcut: 'Y' },
    { label: 'Cell Type: Markdown', action: () => props.onChangeCellType('markdown'), shortcut: 'M' },
  ];

  const kernelItems: MenuItem[] = [
    { label: 'Interrupt', action: props.onInterruptKernel, shortcut: 'I,I', disabled: !props.hasKernel },
    { label: 'Restart', action: props.onRestartKernel, disabled: !props.hasKernel },
    { label: 'Restart & Clear Output', action: props.onRestartAndClear, disabled: !props.hasKernel },
    { label: 'Restart & Run All', action: props.onRestartAndRunAll, disabled: !props.hasKernel },
  ];

  const helpItems: MenuItem[] = [
    { label: 'Keyboard Shortcuts', action: props.onShowShortcuts, shortcut: 'H' },
    { label: 'Settings', action: props.onShowSettings },
    { divider: true, label: '' },
    { label: 'About Saturn', action: () => alert('Saturn v0.1.0\nLightweight Jupyter Notebook') },
  ];

  return (
    <div className="menu-bar">
      <MenuDropdown label="File" items={fileItems} />
      <MenuDropdown label="Edit" items={editItems} />
      <MenuDropdown label="View" items={viewItems} />
      <MenuDropdown label="Insert" items={insertItems} />
      <MenuDropdown label="Cell" items={cellItems} />
      <MenuDropdown label="Kernel" items={kernelItems} />
      <MenuDropdown label="Help" items={helpItems} />
      <span className="file-name">{props.fileName}</span>
    </div>
  );
}
