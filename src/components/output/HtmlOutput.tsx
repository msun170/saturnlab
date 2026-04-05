import { useState, useMemo } from 'react';

const MAX_TABLE_ROWS = 50;

interface HtmlOutputProps {
  html: string;
}

/**
 * ALL HTML output is rendered in a sandboxed iframe to prevent XSS.
 * - Script-bearing HTML: sandbox="allow-scripts" (can run JS but cannot access parent)
 * - Static HTML: sandbox="" (no scripts, no top-nav, no forms, no popups)
 */
export default function HtmlOutput({ html }: HtmlOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const hasScript = /<script/i.test(html);

  const totalRowCount = useMemo(() => {
    const trMatches = html.match(/<tr[\s>]/gi);
    return trMatches?.length ?? 0;
  }, [html]);

  const isLargeTable = totalRowCount > MAX_TABLE_ROWS + 1;

  const { displayHtml, truncatedRows } = useMemo(() => {
    if (expanded || hasScript) return { displayHtml: html, truncatedRows: 0 };

    const trMatches = html.match(/<tr[\s>]/gi);
    const rowCount = trMatches?.length ?? 0;

    if (rowCount <= MAX_TABLE_ROWS + 1) return { displayHtml: html, truncatedRows: 0 };

    let count = 0;
    let cutIndex = -1;
    const trRegex = /<tr[\s>]/gi;
    let match;
    while ((match = trRegex.exec(html)) !== null) {
      count++;
      if (count > MAX_TABLE_ROWS + 1) {
        cutIndex = match.index;
        break;
      }
    }

    if (cutIndex === -1) return { displayHtml: html, truncatedRows: 0 };

    const closingMatch = html.slice(cutIndex).match(/<\/tbody>|<\/table>/i);
    const truncated = html.slice(0, cutIndex) + (closingMatch ? closingMatch[0] : '</tbody></table>');

    return { displayHtml: truncated, truncatedRows: rowCount - MAX_TABLE_ROWS - 1 };
  }, [html, expanded, hasScript]);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const iframeBg = isDark ? '#1e1e1e' : '#fff';
  const iframeColor = isDark ? '#d4d4d4' : '#333';
  const tableStyle = isDark
    ? 'table{border-collapse:collapse}th,td{border:1px solid #555;padding:4px 8px;text-align:right;background:#2d2d2d;color:#d4d4d4}thead th{background:#333}tbody tr:nth-child(odd) td{background:#252526}'
    : 'table{border-collapse:collapse}th,td{border:1px solid #000;padding:4px 8px;text-align:right}tbody tr:nth-child(odd){background:#f5f5f5}';

  const srcDoc = `<!DOCTYPE html><html><head><style>body{margin:4px;font-family:sans-serif;color:${iframeColor};background:${iframeBg};font-size:13px}${tableStyle}img{max-width:100%}</style></head><body>${displayHtml}</body></html>`;

  // Sandbox: allow-scripts for rich output (Plotly, Bokeh), strict sandbox for static HTML
  const sandbox = hasScript ? 'allow-scripts' : '';

  return (
    <div>
      <iframe
        srcDoc={srcDoc}
        sandbox={sandbox}
        className="rich-html-output"
        style={{ width: '100%', border: 'none', minHeight: hasScript ? 200 : 32 }}
        onLoad={(e) => {
          const iframe = e.target as HTMLIFrameElement;
          try {
            const height = iframe.contentDocument?.body?.scrollHeight;
            if (height) iframe.style.height = `${Math.min(height + 16, 2000)}px`;
          } catch {
            // Cross-origin iframe, can't read height
          }
        }}
      />
      {isLargeTable && (
        <button className="output-show-more" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? 'Collapse table'
            : `... ${truncatedRows} more rows (click to expand)`}
        </button>
      )}
    </div>
  );
}
