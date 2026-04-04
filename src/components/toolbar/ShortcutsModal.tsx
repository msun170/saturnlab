interface ShortcutsModalProps {
  onClose: () => void;
}

const commandShortcuts = [
  ['Enter', 'Enter edit mode'],
  ['Esc', 'Enter command mode'],
  ['Shift+Enter', 'Run cell, select below'],
  ['Ctrl+Enter', 'Run cell in place'],
  ['Alt+Enter', 'Run cell, insert below'],
  ['A', 'Insert cell above'],
  ['B', 'Insert cell below'],
  ['D, D', 'Delete cell'],
  ['Ctrl+Z', 'Undo cell deletion'],
  ['Ctrl+X', 'Cut cell'],
  ['Ctrl+C', 'Copy cell'],
  ['Ctrl+V', 'Paste cell below'],
  ['Y', 'Change to code'],
  ['M', 'Change to markdown'],
  ['Up / K', 'Select cell above'],
  ['Down / J', 'Select cell below'],
  ['S', 'Save notebook'],
  ['L', 'Toggle line numbers'],
  ['O', 'Toggle output'],
  ['H', 'Show shortcuts'],
  ['I, I', 'Interrupt kernel'],
  ['0, 0', 'Restart kernel'],
];

const editShortcuts = [
  ['Esc', 'Enter command mode'],
  ['Shift+Enter', 'Run cell, select below'],
  ['Ctrl+Enter', 'Run cell in place'],
  ['Tab', 'Indent / autocomplete'],
  ['Shift+Tab', 'Tooltip'],
  ['Ctrl+/', 'Toggle comment'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
];

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div className="shortcuts-columns">
            <div className="shortcuts-column">
              <h3>Command Mode (Esc)</h3>
              <table className="shortcuts-table">
                <tbody>
                  {commandShortcuts.map(([key, desc]) => (
                    <tr key={key}>
                      <td><kbd>{key}</kbd></td>
                      <td>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="shortcuts-column">
              <h3>Edit Mode (Enter)</h3>
              <table className="shortcuts-table">
                <tbody>
                  {editShortcuts.map(([key, desc]) => (
                    <tr key={key}>
                      <td><kbd>{key}</kbd></td>
                      <td>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
