import type { TabState } from '../../store';

interface SuspendedPlaceholderProps {
  tab: TabState;
  onResume: () => void;
}

export default function SuspendedPlaceholder({ tab, onResume }: SuspendedPlaceholderProps) {
  const isKernelStopped = tab.suspensionLayer === 'layerC';

  return (
    <div className="suspended-placeholder" onClick={onResume}>
      <div className="suspended-content">
        <div className="suspended-icon">
          {isKernelStopped ? '\u23F8' : '\u263E'}
        </div>
        <h3 className="suspended-title">{tab.fileName}</h3>
        <p className="suspended-message">
          {isKernelStopped
            ? 'Kernel was stopped to save memory. Notebook contents are preserved, but live variables are gone.'
            : 'Rendering suspended to save memory.'}
        </p>
        <button className="suspended-resume-btn" onClick={onResume}>
          {isKernelStopped ? 'Resume and Restart Kernel' : 'Click to Resume'}
        </button>
        <p className="suspended-hint">
          {tab.notebook.cells.length} cells, {tab.isDirty ? 'unsaved changes' : 'saved'}
        </p>
      </div>
    </div>
  );
}
