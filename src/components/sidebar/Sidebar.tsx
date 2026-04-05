import { useState } from 'react';
import FileExplorer from './FileExplorer';
import KernelPanel from './KernelPanel';
import TableOfContents from './TableOfContents';
import VariableInspector from './VariableInspector';

type SidebarPanel = 'files' | 'kernels' | 'toc' | 'memory';

interface SidebarProps {
  width: number;
  onResize: (width: number) => void;
}

export default function Sidebar({ width, onResize }: SidebarProps) {
  const [activePanel, setActivePanel] = useState<SidebarPanel | null>('files');

  const togglePanel = (panel: SidebarPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(400, startWidth + (e.clientX - startX)));
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div className="sidebar-container" style={{ width: activePanel ? width : 40 }}>
      {/* Icon strip */}
      <div className="sidebar-icons">
        <button
          className={`sidebar-icon ${activePanel === 'files' ? 'active' : ''}`}
          onClick={() => togglePanel('files')}
          title="File Browser"
        >
          <span className="sidebar-icon-sym">{'\u29C9'}</span>
          <span className="sidebar-icon-label">Files</span>
        </button>
        <button
          className={`sidebar-icon ${activePanel === 'kernels' ? 'active' : ''}`}
          onClick={() => togglePanel('kernels')}
          title="Running Kernels"
        >
          <span className="sidebar-icon-sym">{'\u25B6'}</span>
          <span className="sidebar-icon-label">Kernels</span>
        </button>
        <button
          className={`sidebar-icon ${activePanel === 'toc' ? 'active' : ''}`}
          onClick={() => togglePanel('toc')}
          title="Table of Contents"
        >
          <span className="sidebar-icon-sym">{'\u2630'}</span>
          <span className="sidebar-icon-label">TOC</span>
        </button>
        <button
          className={`sidebar-icon ${activePanel === 'memory' ? 'active' : ''}`}
          onClick={() => togglePanel('memory')}
          title="Variable Inspector"
        >
          <span className="sidebar-icon-sym">x=</span>
          <span className="sidebar-icon-label">Vars</span>
        </button>
      </div>

      {/* Panel content */}
      {activePanel && (
        <div className="sidebar-panel">
          {activePanel === 'files' && <FileExplorer />}
          {activePanel === 'kernels' && <KernelPanel />}
          {activePanel === 'toc' && <TableOfContents />}
          {activePanel === 'memory' && <VariableInspector />}
        </div>
      )}

      {/* Resize handle */}
      {activePanel && (
        <div className="sidebar-resizer" onMouseDown={handleMouseDown} />
      )}
    </div>
  );
}
