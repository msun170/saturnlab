import { useState } from 'react';

const MAX_LINES = 100;

interface TextOutputProps {
  text: string;
  stream: string;
}

export default function TextOutput({ text, stream }: TextOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const truncated = !expanded && lines.length > MAX_LINES;

  const displayText = truncated
    ? lines.slice(0, MAX_LINES).join('\n')
    : text;

  return (
    <pre className={`text-output ${stream === 'stderr' ? 'stderr' : ''}`}>
      {displayText}
      {truncated && (
        <button className="output-show-more" onClick={() => setExpanded(true)}>
          ... {lines.length - MAX_LINES} more lines (click to expand)
        </button>
      )}
    </pre>
  );
}
