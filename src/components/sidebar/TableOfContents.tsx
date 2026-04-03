import { useMemo } from 'react';
import { useAppStore } from '../../store';

interface TocHeading {
  level: number;
  text: string;
  cellIndex: number;
}

/** Extract headings from markdown cells in the active notebook. */
function extractHeadings(cells: { cell_type: string; source: string | string[] }[]): TocHeading[] {
  const headings: TocHeading[] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;

  cells.forEach((cell, index) => {
    if (cell.cell_type !== 'markdown') return;
    const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;

    let match;
    while ((match = headingRegex.exec(source)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        cellIndex: index,
      });
    }
  });

  return headings;
}

export default function TableOfContents() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);

  const headings = useMemo(() => {
    if (!tab) return [];
    return extractHeadings(tab.notebook.cells);
  }, [tab?.notebook.cells]);

  if (!tab) return <div className="toc-empty">No notebook open</div>;
  if (headings.length === 0) return <div className="toc-empty">No headings found</div>;

  return (
    <div className="toc">
      <div className="toc-header">Table of Contents</div>
      <div className="toc-list">
        {headings.map((h, i) => (
          <div
            key={`${h.cellIndex}-${i}`}
            className="toc-item"
            style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
            onClick={() => {
              // Scroll to cell by dispatching a focus change
              // This is a simplified version - in production, scroll the notebook
              const notebookEl = document.querySelector('.notebook');
              const cells = notebookEl?.querySelectorAll('.cell-container');
              if (cells && cells[h.cellIndex]) {
                cells[h.cellIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          >
            <span className={`toc-item-text toc-h${h.level}`}>{h.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Export for testing
export { extractHeadings };
export type { TocHeading };
