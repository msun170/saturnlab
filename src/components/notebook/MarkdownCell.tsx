import { useState, useRef, useEffect, useMemo } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
// Using light theme to match Jupyter classic
import { defaultKeymap } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

// Simple LaTeX rendering: replace $...$ and $$...$$ with KaTeX
function renderLatex(html: string): string {
  // Block math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<span class="katex-error">${tex}</span>`;
    }
  });
  // Inline math: $...$
  html = html.replace(/\$([^$\n]+?)\$/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="katex-error">${tex}</span>`;
    }
  });
  return html;
}

interface MarkdownCellProps {
  source: string;
  isFocused: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onExecute: () => void;
}

export default function MarkdownCell({
  source,
  isFocused,
  onChange,
  onFocus,
  onExecute,
}: MarkdownCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const renderedHtml = useMemo(() => {
    const raw = md.render(source || '*Empty markdown cell*');
    return renderLatex(raw);
  }, [source]);

  // Create editor when entering edit mode
  useEffect(() => {
    if (!isEditing || !editorRef.current) return;

    const shiftEnterKeymap = keymap.of([
      {
        key: 'Shift-Enter',
        run: () => {
          setIsEditing(false);
          onExecute();
          return true;
        },
      },
      {
        key: 'Escape',
        run: () => {
          setIsEditing(false);
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: source,
      extensions: [
        basicSetup,
        markdown(),
        // Light theme — CSS handles the styling
        shiftEnterKeymap,
        keymap.of(defaultKeymap),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [isEditing, source, onExecute]);

  if (isEditing) {
    return (
      <div className={`markdown-cell editing ${isFocused ? 'focused' : ''}`} onClick={onFocus}>
        <div className="cell-gutter" />
        <div className="cell-content">
          <div ref={editorRef} className="code-editor" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`markdown-cell ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
      onDoubleClick={() => setIsEditing(true)}
    >
      <div className="cell-gutter" />
      <div className="cell-content">
        <div
          className="markdown-rendered"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    </div>
  );
}
