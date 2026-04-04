import { useRef, useEffect, type ReactNode } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { defaultKeymap } from '@codemirror/commands';
import { autocompletion, acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';

interface CodeCellProps {
  source: string;
  executionCount: number | null;
  isRunning: boolean;
  isFocused: boolean;
  isEditing: boolean;
  showLineNumbers: boolean;
  kernelId: string | null;
  onChange: (value: string) => void;
  onExecute: () => void;
  onFocus: () => void;
  children?: ReactNode;
}

export default function CodeCell({
  source,
  executionCount,
  isRunning,
  isFocused,
  isEditing,
  showLineNumbers,
  kernelId,
  onChange,
  onExecute,
  onFocus,
  children,
}: CodeCellProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const kernelIdRef = useRef(kernelId);

  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;
  kernelIdRef.current = kernelId;

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

    // Kernel-powered completion source
    const kernelCompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const kid = kernelIdRef.current;
      if (!kid) return null;
      const word = context.matchBefore(/[\w.]+/);
      if (!word) return null;

      try {
        const { completeCode } = await import('../../lib/ipc');
        const result = await completeCode(kid, context.state.doc.toString(), context.pos);
        if (result.status !== 'ok' || !result.matches?.length) return null;
        return {
          from: result.cursor_start,
          options: result.matches.map((m: string) => ({ label: m })),
        };
      } catch {
        return null;
      }
    };

    // Shift+Tab tooltip handler
    const shiftTabKeymap = keymap.of([{
      key: 'Shift-Tab',
      run: (view) => {
        const kid = kernelIdRef.current;
        if (!kid) return false;
        const pos = view.state.selection.main.head;
        const code = view.state.doc.toString();
        import('../../lib/ipc').then(async ({ inspectCode }) => {
          try {
            const result = await inspectCode(kid, code, pos);
            if (result.found && result.data?.['text/plain']) {
              // Convert ANSI to HTML for colored tooltip
              const rawText = result.data['text/plain'];
              const Convert = (await import('ansi-to-html')).default;
              const convert = new Convert({ fg: '#333', bg: '#fff', newline: true });
              const htmlContent = convert.toHtml(rawText);

              const tooltip = document.createElement('div');
              tooltip.className = 'kernel-tooltip';
              tooltip.innerHTML = htmlContent;
              const coords = view.coordsAtPos(pos);
              if (coords) {
                tooltip.style.position = 'fixed';
                tooltip.style.left = `${coords.left}px`;
                tooltip.style.top = `${coords.top - 8}px`;
                tooltip.style.transform = 'translateY(-100%)';
              }
              document.body.appendChild(tooltip);
              setTimeout(() => tooltip.remove(), 5000);
              // Click anywhere to dismiss
              const dismiss = () => { tooltip.remove(); document.removeEventListener('click', dismiss); };
              document.addEventListener('click', dismiss);
            }
          } catch { /* ignore */ }
        });
        return true;
      },
    }]);

    const state = EditorState.create({
      doc: source,
      extensions: [
        Prec.highest(shiftEnterKeymap),
        Prec.high(shiftTabKeymap),
        basicSetup,
        python(),
        jupyterLightTheme,
        keymap.of(defaultKeymap),
        autocompletion({
          override: [kernelCompletionSource],
          activateOnTyping: true,
        }),
        // Tab: accept completion if popup open, otherwise insert indent
        Prec.highest(keymap.of([{
          key: 'Tab',
          run: (view) => {
            // Try to accept completion first
            if (acceptCompletion(view)) return true;
            // Otherwise insert 4 spaces (Python indent)
            view.dispatch(view.state.replaceSelection('    '));
            return true;
          },
        }])),
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
    // Only create editor once on mount (source is initial value)
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
      {children}
    </div>
  );
}
