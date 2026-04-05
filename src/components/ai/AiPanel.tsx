import { useState } from 'react';

interface AiPanelProps {
  type: 'explain' | 'fix' | 'generate';
  result: string | null;
  loading: boolean;
  error: string | null;
  onApply?: (code: string) => void;
  onDismiss: () => void;
}

export default function AiPanel({ type, result, loading, error, onApply, onDismiss }: AiPanelProps) {
  const [applied, setApplied] = useState(false);

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <span className="ai-panel-title">
          {type === 'explain' ? '\u2139 Explain' : type === 'fix' ? '\u2692 Fix' : '\u2728 Generate'}
        </span>
        <button className="ai-panel-close" onClick={onDismiss}>{'\u00D7'}</button>
      </div>
      <div className="ai-panel-body">
        {loading && (
          <div className="ai-panel-loading">Thinking...</div>
        )}
        {error && (
          <div className="ai-panel-error">{error}</div>
        )}
        {result && (
          <pre className="ai-panel-result">{result}</pre>
        )}
      </div>
      {result && (type === 'fix' || type === 'generate') && onApply && (
        <div className="ai-panel-actions">
          <button
            className="ai-panel-apply"
            onClick={() => { onApply(result); setApplied(true); }}
            disabled={applied}
          >
            {applied ? 'Applied' : 'Apply to cell'}
          </button>
        </div>
      )}
    </div>
  );
}
