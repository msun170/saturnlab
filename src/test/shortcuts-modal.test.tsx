import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ShortcutsModal from '../components/toolbar/ShortcutsModal';

describe('ShortcutsModal', () => {
  it('renders command mode and edit mode sections', () => {
    render(<ShortcutsModal onClose={vi.fn()} />);

    expect(screen.getByText('Command Mode (Esc)')).toBeTruthy();
    expect(screen.getByText('Edit Mode (Enter)')).toBeTruthy();
  });

  it('shows key Jupyter shortcuts', () => {
    render(<ShortcutsModal onClose={vi.fn()} />);

    // Some shortcuts appear in both columns, so use getAllByText
    expect(screen.getByText('Enter edit mode')).toBeTruthy();
    expect(screen.getAllByText('Enter command mode').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Run cell, select below').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Insert cell above')).toBeTruthy();
    expect(screen.getByText('Insert cell below')).toBeTruthy();
    expect(screen.getByText('Delete cell')).toBeTruthy();
    expect(screen.getByText('Cut cell')).toBeTruthy();
    expect(screen.getByText('Copy cell')).toBeTruthy();
    expect(screen.getByText('Paste cell below')).toBeTruthy();
    expect(screen.getByText('Undo cell deletion')).toBeTruthy();
    expect(screen.getByText('Toggle line numbers')).toBeTruthy();
    expect(screen.getByText('Interrupt kernel')).toBeTruthy();
    expect(screen.getByText('Restart kernel')).toBeTruthy();
  });

  it('renders keyboard key badges', () => {
    render(<ShortcutsModal onClose={vi.fn()} />);

    const kbds = document.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThan(10);
  });

  it('calls onClose when x button is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal onClose={onClose} />);

    fireEvent.click(screen.getByText('x'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal onClose={onClose} />);

    // Click the overlay (the outermost div)
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when modal content is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal onClose={onClose} />);

    const content = document.querySelector('.modal-content');
    if (content) fireEvent.click(content);
    expect(onClose).not.toHaveBeenCalled();
  });
});
