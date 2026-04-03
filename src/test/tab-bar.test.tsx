import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from '../components/tabs/TabBar';
import { useAppStore } from '../store/tabStore';

describe('TabBar', () => {
  beforeEach(() => {
    // Reset store
    const tab = useAppStore.getState().tabs[0];
    useAppStore.setState({
      tabs: [{ ...tab, fileName: 'notebook1.ipynb' }],
      activeTabId: tab.id,
    });
  });

  it('renders the active tab', () => {
    render(<TabBar />);
    expect(screen.getByText('notebook1.ipynb')).toBeTruthy();
  });

  it('renders the + button', () => {
    render(<TabBar />);
    expect(screen.getByTitle('New notebook')).toBeTruthy();
  });

  it('clicking + adds a new tab', () => {
    render(<TabBar />);
    fireEvent.click(screen.getByTitle('New notebook'));
    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(2);
  });

  it('renders multiple tabs', () => {
    useAppStore.getState().addTab({ fileName: 'notebook2.ipynb' });
    render(<TabBar />);
    expect(screen.getByText('notebook1.ipynb')).toBeTruthy();
    expect(screen.getByText('notebook2.ipynb')).toBeTruthy();
  });

  it('clicking a tab switches to it', () => {
    const id1 = useAppStore.getState().tabs[0].id;
    useAppStore.getState().addTab({ fileName: 'notebook2.ipynb' });

    render(<TabBar />);
    fireEvent.click(screen.getByText('notebook1.ipynb'));
    expect(useAppStore.getState().activeTabId).toBe(id1);
  });

  it('active tab has active class', () => {
    useAppStore.getState().addTab({ fileName: 'notebook2.ipynb' });
    const { container } = render(<TabBar />);

    const activeTabs = container.querySelectorAll('.saturn-tab-active');
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0].textContent).toContain('notebook2.ipynb');
  });

  it('close button removes tab', () => {
    useAppStore.getState().addTab({ fileName: 'notebook2.ipynb' });
    render(<TabBar />);

    const closeButtons = screen.getAllByTitle('Close');
    expect(closeButtons.length).toBe(2);

    // Close the first tab
    fireEvent.click(closeButtons[0]);
    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].fileName).toBe('notebook2.ipynb');
  });

  it('shows dirty indicator when tab is dirty', () => {
    const id = useAppStore.getState().tabs[0].id;
    useAppStore.getState().updateTab(id, { isDirty: true });

    const { container } = render(<TabBar />);
    const dirty = container.querySelector('.saturn-tab-dirty');
    expect(dirty).toBeTruthy();
  });

  it('does not show dirty indicator when tab is clean', () => {
    const id = useAppStore.getState().tabs[0].id;
    useAppStore.getState().updateTab(id, { isDirty: false });

    const { container } = render(<TabBar />);
    const dirty = container.querySelector('.saturn-tab-dirty');
    expect(dirty).toBeNull();
  });
});
