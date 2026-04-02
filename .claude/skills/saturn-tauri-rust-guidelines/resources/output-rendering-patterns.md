# Output Rendering Patterns

## MIME Bundle Resolution

Jupyter outputs contain multiple representations. Pick the richest one the frontend can render:

```typescript
const MIME_PRIORITY: string[] = [
  'application/vnd.plotly.v1+json',
  'application/vnd.vegalite.v5+json',
  'application/vnd.vegalite.v4+json',
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'text/latex',
  'text/markdown',
  'text/plain',
];

function selectMimeType(data: Record<string, string>): string {
  for (const mime of MIME_PRIORITY) {
    if (mime in data) return mime;
  }
  return 'text/plain';
}
```

## Output Component Router

```tsx
function OutputRenderer({ output }: { output: Output }) {
  if (output.output_type === 'stream') {
    return <TextOutput text={output.text} name={output.name} />;
  }
  if (output.output_type === 'error') {
    return <ErrorOutput ename={output.ename} evalue={output.evalue} traceback={output.traceback} />;
  }
  // display_data or execute_result
  const mime = selectMimeType(output.data);
  switch (mime) {
    case 'application/vnd.plotly.v1+json':
      return <PlotlyOutput data={output.data[mime]} />;
    case 'application/vnd.vegalite.v5+json':
    case 'application/vnd.vegalite.v4+json':
      return <VegaOutput spec={output.data[mime]} />;
    case 'text/html':
      return <HtmlOutput html={output.data[mime]} />;
    case 'image/svg+xml':
      return <ImageOutput src={output.data[mime]} type="svg" />;
    case 'image/png':
      return <ImageOutput src={output.data[mime]} type="png" />;
    case 'text/latex':
      return <LatexOutput latex={output.data[mime]} />;
    default:
      return <TextOutput text={output.data['text/plain'] ?? ''} />;
  }
}
```

## Lazy Image Decoding with IntersectionObserver

```tsx
function ImageOutput({ src, type }: { src: string; type: 'png' | 'svg' | 'jpeg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { rootMargin: '200px' } // start loading 200px before visible
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  if (!isVisible) {
    return <div ref={ref} className="image-placeholder" style={{ minHeight: 100 }} />;
  }

  const dataUri = type === 'svg'
    ? `data:image/svg+xml;base64,${btoa(src)}`
    : `data:image/${type};base64,${src}`;

  return (
    <div ref={ref}>
      <img src={dataUri} loading="lazy" decoding="async" />
    </div>
  );
}
```

## HTML Output — Sandboxed iframe for Scripts

Plain HTML (DataFrames) renders inline. HTML with `<script>` tags gets sandboxed:

```tsx
function HtmlOutput({ html }: { html: string }) {
  const hasScript = /<script/i.test(html);

  if (!hasScript) {
    return <div className="html-output" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Sandboxed iframe for HTML with scripts (Bokeh, custom widgets)
  const srcDoc = `
    <!DOCTYPE html>
    <html>
    <head><style>body { margin: 0; font-family: sans-serif; }</style></head>
    <body>${html}</body>
    </html>
  `;

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="rich-html-output"
      style={{ width: '100%', border: 'none', minHeight: 300 }}
      onLoad={(e) => {
        // Auto-resize iframe to content
        const iframe = e.target as HTMLIFrameElement;
        const height = iframe.contentDocument?.body?.scrollHeight;
        if (height) iframe.style.height = `${height}px`;
      }}
    />
  );
}
```

## Plotly Integration

Load plotly.js on demand (it's 3MB+):

```tsx
let plotlyLoaded = false;

async function loadPlotly() {
  if (plotlyLoaded) return;
  // Dynamic import to avoid bundling
  await import('plotly.js-dist-min');
  plotlyLoaded = true;
}

function PlotlyOutput({ data }: { data: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const spec = JSON.parse(data);

  useEffect(() => {
    loadPlotly().then(() => {
      if (ref.current) {
        (window as unknown as Record<string, unknown>).Plotly?.newPlot(
          ref.current, spec.data, spec.layout, { responsive: true }
        );
      }
    });
  }, [data]);

  return <div ref={ref} className="plotly-output" />;
}
```

## Output Pagination

```tsx
const MAX_LINES = 100;

function TextOutput({ text }: { text: string | string[] }) {
  const content = Array.isArray(text) ? text.join('') : text;
  const lines = content.split('\n');
  const [expanded, setExpanded] = useState(false);

  const displayLines = expanded ? lines : lines.slice(0, MAX_LINES);
  const truncated = !expanded && lines.length > MAX_LINES;

  return (
    <pre className="text-output">
      {displayLines.join('\n')}
      {truncated && (
        <button className="show-more" onClick={() => setExpanded(true)}>
          ... {lines.length - MAX_LINES} more lines (click to expand)
        </button>
      )}
    </pre>
  );
}
```

## Error Output with ANSI Colors

Use `ansi-to-html` library:

```tsx
import Convert from 'ansi-to-html';

const convert = new Convert({ fg: '#d4d4d4', bg: '#1e1e1e' });

function ErrorOutput({ ename, evalue, traceback }: ErrorOutputProps) {
  const html = traceback.map(line => convert.toHtml(line)).join('\n');

  return (
    <div className="error-output">
      <pre dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
```

## Virtual Scrolling with react-window

```tsx
import { VariableSizeList } from 'react-window';

function Notebook({ cells }: { cells: Cell[] }) {
  const listRef = useRef<VariableSizeList>(null);
  const sizeMap = useRef<Map<number, number>>(new Map());

  const getItemSize = (index: number) => sizeMap.current.get(index) ?? 150;

  const setItemSize = (index: number, size: number) => {
    sizeMap.current.set(index, size);
    listRef.current?.resetAfterIndex(index);
  };

  return (
    <VariableSizeList
      ref={listRef}
      height={window.innerHeight}
      width="100%"
      itemCount={cells.length}
      itemSize={getItemSize}
      overscanCount={3}
    >
      {({ index, style }) => (
        <div style={style}>
          <CellMeasurer index={index} onResize={setItemSize}>
            <Cell cell={cells[index]} />
          </CellMeasurer>
        </div>
      )}
    </VariableSizeList>
  );
}
```

## CSS from JupyterLab (BSD-3)

Key CSS to copy/adapt from JupyterLab source:
- Cell container styling (borders, margins, selection highlight)
- Execution counter styling (`[1]:` indicator)
- Output area styling (background, padding, scrolling)
- Error output styling (red background, monospace)
- Markdown rendered content styling (headers, lists, tables, code blocks)
- Toolbar and status bar styling
- Dark/light theme variables

Source: `@jupyterlab/cells/style/`, `@jupyterlab/outputarea/style/`, `@jupyterlab/theme-light-extension/`
