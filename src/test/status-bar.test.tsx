import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBar from '../components/statusbar/StatusBar';
import { useAppStore } from '../store/tabStore';

describe('StatusBar', () => {
  beforeEach(() => {
    const tab = useAppStore.getState().tabs[0];
    useAppStore.setState({
      tabs: [{ ...tab, fileName: 'test.ipynb', kernelStatus: 'idle', editMode: false, isDirty: false }],
      activeTabId: tab.id,
    });
  });

  it('shows kernel name from notebook metadata', () => {
    render(<StatusBar />);
    expect(screen.getByText('Python 3')).toBeTruthy();
  });

  it('shows kernel status', () => {
    render(<StatusBar />);
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it('shows Command mode when editMode is false', () => {
    render(<StatusBar />);
    expect(screen.getByText('Command')).toBeTruthy();
  });

  it('shows Edit mode when editMode is true', () => {
    const id = useAppStore.getState().tabs[0].id;
    useAppStore.getState().updateTab(id, { editMode: true });

    render(<StatusBar />);
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('shows Unsaved when dirty', () => {
    const id = useAppStore.getState().tabs[0].id;
    useAppStore.getState().updateTab(id, { isDirty: true });

    render(<StatusBar />);
    expect(screen.getByText('Unsaved')).toBeTruthy();
  });

  it('does not show Unsaved when clean', () => {
    render(<StatusBar />);
    expect(screen.queryByText('Unsaved')).toBeNull();
  });
});
