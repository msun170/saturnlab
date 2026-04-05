import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { basicSetup } from 'codemirror';

interface TextEditorProps {
  content: string;
  fileName: string;
  onChange: (content: string) => void;
}

function getLanguageFromFilename(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'py':
    case 'pyw':
      return python();
    case 'js':
    case 'jsx':
    case 'mjs':
      return javascript();
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true });
    case 'md':
    case 'markdown':
      return markdown();
    default:
      return [];
  }
}

export default function TextEditor({ content, fileName, onChange }: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const highlightCompartment = new Compartment();

    const editorTheme = EditorView.theme({
      '&': {
        backgroundColor: 'var(--bg-page)',
        color: 'var(--text-color)',
        height: '100%',
      },
      '.cm-content': {
        caretColor: 'var(--text-color)',
        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize: 'var(--editor-font-size, 14px)',
        lineHeight: '1.5',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-frame)',
        borderRight: '1px solid var(--border-color)',
        color: 'var(--text-muted)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: 'var(--text-color)',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--cm-selection, #d7d4f0)',
      },
      '.cm-scroller': {
        overflow: 'auto',
        height: '100%',
      },
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        lineNumbers(),
        getLanguageFromFilename(fileName),
        editorTheme,
        highlightCompartment.of(
          syntaxHighlighting(isDark ? oneDarkHighlightStyle : defaultHighlightStyle)
        ),
        keymap.of([...defaultKeymap, indentWithTab]),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    // Watch for theme changes
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      view.dispatch({
        effects: highlightCompartment.reconfigure(
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle)
        ),
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    view.focus();

    return () => {
      observer.disconnect();
      view.destroy();
      viewRef.current = null;
    };
  }, [fileName]); // Re-create editor when file changes

  // Sync editor when content changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
      });
    }
  }, [content]);

  return (
    <div className="text-editor-panel">
      <div ref={containerRef} className="text-editor-container" />
    </div>
  );
}
