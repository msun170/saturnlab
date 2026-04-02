import { useRef, useEffect } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';

interface CodeCellProps {
  source: string;
  executionCount: number | null;
  isRunning: boolean;
  isFocused: boolean;
  isEditing: boolean;
  showLineNumbers: boolean;
  onChange: (value: string) => void;
  onExecute: () => void;
  onFocus: () => void;
}

export default function CodeCell({
  source,
  executionCount,
  isRunning,
  isFocused,
  isEditing,
  showLineNumbers,
  onChange,
  onExecute,
  onFocus,
}: CodeCellProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);

  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;

  useEffect(() => {
    if (!editorRef.current) return;

    const shiftEnterKeymap = keymap.of([
      {
        key: 'Shift-Enter',
        run: () => {
          onExecuteRef.current();
          return true;
        },
      },
      {
        key: 'Ctrl-Enter',
        run: () => {
          onExecuteRef.current();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    // Light theme matching Jupyter's #f7f7f7 cell background
    const jupyterLightTheme = EditorView.theme({
      '&': {
        backgroundColor: '#f7f7f7',
        color: '#333',
      },
      '.cm-content': {
        caretColor: '#333',
        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize: '14px',
        lineHeight: '20px',
      },
      '.cm-gutters': {
        backgroundColor: '#f7f7f7',
        borderRight: 'none',
        color: '#999',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(0, 0, 0, 0.04)',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: '#333',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: '#d7d4f0',
      },
    });

    const state = EditorState.create({
      doc: source,
      extensions: [
        basicSetup,
        python(),
        jupyterLightTheme,
        shiftEnterKeymap,
        keymap.of([indentWithTab, ...defaultKeymap]),
        autocompletion(),
        updateListener,
        cmPlaceholder(''),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isEditing && viewRef.current) {
      viewRef.current.focus();
    }
  }, [isEditing]);

  // Format execution count like Jupyter: In [1]: or In [*]: or In [ ]:
  let countDisplay: string;
  if (isRunning) {
    countDisplay = '*';
  } else if (executionCount !== null) {
    countDisplay = String(executionCount);
  } else {
    countDisplay = ' ';
  }

  const cellClass = [
    'code-cell',
    isFocused ? 'focused' : '',
    isEditing ? 'editing' : '',
    !showLineNumbers ? 'hide-line-numbers' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cellClass} onClick={onFocus}>
      <div className="cell-input-row">
        <div className="cell-gutter">
          <span className="prompt-in">In&nbsp;[{countDisplay}]:</span>
        </div>
        <div className="cell-content">
          <div ref={editorRef} className="code-editor" />
        </div>
      </div>
    </div>
  );
}
