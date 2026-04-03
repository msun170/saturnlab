import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MenuBar from '../components/toolbar/MenuBar';

function createMockProps() {
  return {
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onNewNotebook: vi.fn(),
    onCloseTab: vi.fn(),
    onDownloadPy: vi.fn(),
    onSaveWithoutOutputs: vi.fn(),
    onCutCell: vi.fn(),
    onCopyCell: vi.fn(),
    onPasteCell: vi.fn(),
    onDeleteCell: vi.fn(),
    onUndoDelete: vi.fn(),
    onInsertAbove: vi.fn(),
    onInsertBelow: vi.fn(),
    onRunCell: vi.fn(),
    onRunAll: vi.fn(),
    onRunAllAbove: vi.fn(),
    onRunAllBelow: vi.fn(),
    onChangeCellType: vi.fn(),
    onInterruptKernel: vi.fn(),
    onRestartKernel: vi.fn(),
    onRestartAndClear: vi.fn(),
    onRestartAndRunAll: vi.fn(),
    onToggleLineNumbers: vi.fn(),
    onShowShortcuts: vi.fn(),
    fileName: 'test.ipynb',
    hasKernel: true,
  };
}

describe('MenuBar', () => {
  it('renders all menu labels', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    expect(screen.getByText('File')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
    expect(screen.getByText('Insert')).toBeTruthy();
    expect(screen.getByText('Cell')).toBeTruthy();
    expect(screen.getByText('Kernel')).toBeTruthy();
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('shows file name', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);
    expect(screen.getByText('test.ipynb')).toBeTruthy();
  });

  it('opens File dropdown on click', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Open...')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Save As...')).toBeTruthy();
  });

  it('calls onOpen when File > Open is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Open...'));
    expect(props.onOpen).toHaveBeenCalledOnce();
  });

  it('calls onSave when File > Save is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Save'));
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it('opens Edit dropdown with cell operations', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Cut Cell')).toBeTruthy();
    expect(screen.getByText('Copy Cell')).toBeTruthy();
    expect(screen.getByText('Paste Cell Below')).toBeTruthy();
    expect(screen.getByText('Delete Cell')).toBeTruthy();
    expect(screen.getByText('Undo Cell Deletion')).toBeTruthy();
  });

  it('calls onCutCell when Edit > Cut Cell is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cut Cell'));
    expect(props.onCutCell).toHaveBeenCalledOnce();
  });

  it('opens Insert dropdown', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Insert'));
    expect(screen.getByText('Insert Cell Above')).toBeTruthy();
    expect(screen.getByText('Insert Cell Below')).toBeTruthy();
  });

  it('calls onInsertBelow when Insert > Insert Cell Below is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Insert'));
    fireEvent.click(screen.getByText('Insert Cell Below'));
    expect(props.onInsertBelow).toHaveBeenCalledOnce();
  });

  it('opens Cell dropdown with run options', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Cell'));
    expect(screen.getByText('Run Cell')).toBeTruthy();
    expect(screen.getByText('Run All')).toBeTruthy();
  });

  it('calls onRunAll when Cell > Run All is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Cell'));
    fireEvent.click(screen.getByText('Run All'));
    expect(props.onRunAll).toHaveBeenCalledOnce();
  });

  it('opens Kernel dropdown', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Kernel'));
    expect(screen.getByText('Interrupt')).toBeTruthy();
    expect(screen.getByText('Restart')).toBeTruthy();
    expect(screen.getByText('Restart & Clear Output')).toBeTruthy();
    expect(screen.getByText('Restart & Run All')).toBeTruthy();
  });

  it('calls onRestartAndClear when clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Kernel'));
    fireEvent.click(screen.getByText('Restart & Clear Output'));
    expect(props.onRestartAndClear).toHaveBeenCalledOnce();
  });

  it('opens Help dropdown with shortcuts option', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Help'));
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
  });

  it('calls onShowShortcuts when Help > Keyboard Shortcuts is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Help'));
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));
    expect(props.onShowShortcuts).toHaveBeenCalledOnce();
  });

  it('calls onToggleLineNumbers when View > Toggle Line Numbers is clicked', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('View'));
    fireEvent.click(screen.getByText('Toggle Line Numbers'));
    expect(props.onToggleLineNumbers).toHaveBeenCalledOnce();
  });

  it('disables kernel actions when no kernel is connected', () => {
    const props = createMockProps();
    props.hasKernel = false;
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('Kernel'));
    const interruptItem = screen.getByText('Interrupt');
    expect(interruptItem.closest('.menu-dropdown-item')?.classList.contains('disabled')).toBe(true);
  });

  it('closes dropdown when clicking an item', () => {
    const props = createMockProps();
    render(<MenuBar {...props} />);

    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Open...')).toBeTruthy();

    fireEvent.click(screen.getByText('Open...'));
    // Dropdown should be closed now
    expect(screen.queryByText('Save As...')).toBeNull();
  });
});
