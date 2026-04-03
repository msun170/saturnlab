import { useState } from 'react';

const MAX_LINES = 100;

interface TextOutputProps {
  text: string;
  stream: string;
}

export default function TextOutput({ text, stream }: TextOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const isLong = lines.length > MAX_LINES;

  const displayText = !expanded && isLong
    ? lines.slice(0, MAX_LINES).join('\n')
    : text;

  return (
    <pre className={`text-output ${stream === 'stderr' ? 'stderr' : ''}`}>
      {displayText}
      {isLong && (
        <button className="output-show-more" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? 'Collapse output'
            : `... ${lines.length - MAX_LINES} more lines (click to expand)`}
        </button>
      )}
    </pre>
  );
}
