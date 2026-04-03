import { useState, useRef, useEffect, useCallback } from 'react';

interface SearchBarProps {
  onClose: () => void;
  onSearch: (query: string, matchCase: boolean) => SearchResult[];
  onReplace: (query: string, replacement: string, matchCase: boolean) => void;
  onReplaceAll: (query: string, replacement: string, matchCase: boolean) => void;
}

export interface SearchResult {
  cellIndex: number;
  lineNumber: number;
  text: string;
}

export default function SearchBar({ onClose, onSearch, onReplace, onReplaceAll }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query) {
      const found = onSearch(query, matchCase);
      setResults(found);
      setCurrentMatch(0);
    } else {
      setResults([]);
    }
  }, [query, matchCase, onSearch]);

  const handleNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (currentMatch + 1) % results.length;
    setCurrentMatch(next);
    // Scroll to match
    const match = results[next];
    const cells = document.querySelectorAll('.cell-container');
    cells[match.cellIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [results, currentMatch]);

  const handlePrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (currentMatch - 1 + results.length) % results.length;
    setCurrentMatch(prev);
    const match = results[prev];
    const cells = document.querySelectorAll('.cell-container');
    cells[match.cellIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [results, currentMatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNext(); }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handlePrev(); }
  };

  return (
    <div className="search-bar">
      <div className="search-bar-row">
        <button className="search-toggle-replace" onClick={() => setShowReplace(!showReplace)} title="Toggle replace">
          {showReplace ? '\u25BC' : '\u25B6'}
        </button>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Find..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <label className="search-match-case" title="Match case">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
          Aa
        </label>
        <span className="search-count">
          {results.length > 0 ? `${currentMatch + 1} of ${results.length}` : query ? 'No results' : ''}
        </span>
        <button onClick={handlePrev} disabled={results.length === 0} className="search-nav-btn" title="Previous (Shift+Enter)">{'\u25B2'}</button>
        <button onClick={handleNext} disabled={results.length === 0} className="search-nav-btn" title="Next (Enter)">{'\u25BC'}</button>
        <button onClick={onClose} className="search-close-btn" title="Close (Esc)">x</button>
      </div>
      {showReplace && (
        <div className="search-bar-row">
          <div style={{ width: 24 }} />
          <input
            className="search-input"
            placeholder="Replace..."
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <button
            onClick={() => onReplace(query, replacement, matchCase)}
            disabled={results.length === 0}
            className="search-action-btn"
          >
            Replace
          </button>
          <button
            onClick={() => { onReplaceAll(query, replacement, matchCase); setResults(onSearch(query, matchCase)); }}
            disabled={results.length === 0}
            className="search-action-btn"
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}
