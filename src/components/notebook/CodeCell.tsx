import { useRef, useEffect, type ReactNode } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Prec, Compartment } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { defaultKeymap } from '@codemirror/commands';
import { autocompletion, acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
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

    // Theme using CSS variables so it auto-switches with light/dark
    const jupyterLightTheme = EditorView.theme({
      '&': {
        backgroundColor: 'var(--bg-cell)',
        color: 'var(--text-color)',
      },
      '.cm-content': {
        caretColor: 'var(--text-color)',
        fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize: 'var(--editor-font-size, 14px)',
        lineHeight: '1.5',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-cell)',
        borderRight: 'none',
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
              const tooltipDark = document.documentElement.getAttribute('data-theme') === 'dark';
              const convert = new Convert({ fg: tooltipDark ? '#d4d4d4' : '#333', bg: tooltipDark ? '#252526' : '#fff', newline: true });
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

    // Syntax highlight style: switch based on current theme
    const highlightCompartment = new Compartment();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const highlightExt = highlightCompartment.of(
      syntaxHighlighting(isDark ? oneDarkHighlightStyle : defaultHighlightStyle)
    );

    const state = EditorState.create({
      doc: source,
      extensions: [
        Prec.highest(shiftEnterKeymap),
        Prec.high(shiftTabKeymap),
        basicSetup,
        python(),
        jupyterLightTheme,
        highlightExt,
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

    // Watch for theme changes and swap syntax highlight style
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      view.dispatch({
        effects: highlightCompartment.reconfigure(
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle)
        ),
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
      view.destroy();
      viewRef.current = null;
    };
    // Only create editor once on mount (source is initial value)
  }, []);

  // Sync CodeMirror when source changes externally (AI apply, replace-all, etc.)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== source) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: source },
      });
    }
  }, [source]);

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
