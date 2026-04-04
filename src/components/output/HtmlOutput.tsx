import { useState, useMemo } from 'react';

const MAX_TABLE_ROWS = 50;

interface HtmlOutputProps {
  html: string;
}

export default function HtmlOutput({ html }: HtmlOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const hasScript = /<script/i.test(html);

  // Preview mode: truncate large tables
  const totalRowCount = useMemo(() => {
    const trMatches = html.match(/<tr[\s>]/gi);
    return trMatches?.length ?? 0;
  }, [html]);

  const isLargeTable = totalRowCount > MAX_TABLE_ROWS + 1;

  const { displayHtml, truncatedRows } = useMemo(() => {
    if (expanded || hasScript) return { displayHtml: html, truncatedRows: 0 };

    // Count <tr> tags
    const trMatches = html.match(/<tr[\s>]/gi);
    const rowCount = trMatches?.length ?? 0;

    if (rowCount <= MAX_TABLE_ROWS + 1) return { displayHtml: html, truncatedRows: 0 };

    // Truncate: keep header + first MAX_TABLE_ROWS data rows
    let count = 0;
    let cutIndex = -1;
    const trRegex = /<tr[\s>]/gi;
    let match;
    while ((match = trRegex.exec(html)) !== null) {
      count++;
      if (count > MAX_TABLE_ROWS + 1) { // +1 for header row
        cutIndex = match.index;
        break;
      }
    }

    if (cutIndex === -1) return { displayHtml: html, truncatedRows: 0 };

    // Find the closing </tbody> or </table> after the cut point
    const closingMatch = html.slice(cutIndex).match(/<\/tbody>|<\/table>/i);
    const truncated = html.slice(0, cutIndex) + (closingMatch ? closingMatch[0] : '</tbody></table>');

    return { displayHtml: truncated, truncatedRows: rowCount - MAX_TABLE_ROWS - 1 };
  }, [html, expanded, hasScript]);

  if (hasScript) {
    const srcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:sans-serif;color:#333;background:#fff;}</style></head><body>${html}</body></html>`;
    return (
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="rich-html-output"
        style={{ width: '100%', border: 'none', minHeight: 200 }}
        onLoad={(e) => {
          const iframe = e.target as HTMLIFrameElement;
          const height = iframe.contentDocument?.body?.scrollHeight;
          if (height) iframe.style.height = `${height + 16}px`;
        }}
      />
    );
  }

  return (
    <div>
      <div
        className="html-output"
        dangerouslySetInnerHTML={{ __html: displayHtml }}
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
