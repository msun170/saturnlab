import { memo } from 'react';
import type { Output } from '../../types/notebook';
import TextOutput from './TextOutput';
import ImageOutput from './ImageOutput';
import HtmlOutput from './HtmlOutput';
import ErrorOutput from './ErrorOutput';

interface OutputAreaProps {
  outputs: Output[];
}

// Memoize to prevent re-rendering unchanged outputs when sibling cells change
const OutputArea = memo(function OutputArea({ outputs }: OutputAreaProps) {
  if (outputs.length === 0) return null;

  return (
    <div className="output-area">
      {outputs.map((output, i) => (
        <div key={i} className="output-row">
          {/* Prompt column: Out[n] for execute_result, empty spacer for others */}
          <div className="output-prompt">
            {output.output_type === 'execute_result' && output.execution_count != null && (
              <span className="prompt-out">Out[{output.execution_count}]:</span>
            )}
          </div>
          <div className="output-content">
            <OutputRenderer output={output} />
          </div>
        </div>
      ))}
    </div>
  );
});

export default OutputArea;

function OutputRenderer({ output }: { output: Output }) {
  switch (output.output_type) {
    case 'stream': {
      const text = Array.isArray(output.text) ? output.text.join('') : (output.text ?? '');
      return <TextOutput text={text} stream={output.name ?? 'stdout'} />;
    }

    case 'error': {
      return (
        <ErrorOutput
          ename={output.ename ?? ''}
          evalue={output.evalue ?? ''}
          traceback={output.traceback ?? []}
        />
      );
    }

    case 'execute_result':
    case 'display_data': {
      const data = output.data ?? {};
      return <MimeRenderer data={data} />;
    }

    default:
      return <pre className="text-output">{JSON.stringify(output, null, 2)}</pre>;
  }
}

/** Render the richest available MIME type from a data bundle.
 * Plotly, Bokeh, and Altair all output text/html with embedded scripts.
 * Our HtmlOutput renders HTML with scripts in sandboxed iframes (5.4),
 * so these libraries work out of the box.
 */
function MimeRenderer({ data }: { data: Record<string, unknown> }) {
  // Plotly JSON: render via plotly.js CDN in an iframe
  if (data['application/vnd.plotly.v1+json']) {
    const spec = data['application/vnd.plotly.v1+json'];
    const specJson = typeof spec === 'string' ? spec : JSON.stringify(spec);
    const html = `<div id="plotly-chart" style="width:100%;height:400px"></div>
      <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"><\/script>
      <script>
        var spec = ${specJson};
        Plotly.newPlot('plotly-chart', spec.data || [], spec.layout || {}, {responsive:true});
      <\/script>`;
    return <HtmlOutput html={html} />;
  }

  // Vega/Altair JSON: render via vega-embed CDN
  const vegaKey = Object.keys(data).find((k) => k.startsWith('application/vnd.vega'));
  if (vegaKey) {
    const spec = data[vegaKey];
    const specJson = typeof spec === 'string' ? spec : JSON.stringify(spec);
    const html = `<div id="vega-chart"></div>
      <script src="https://cdn.jsdelivr.net/npm/vega@5"><\/script>
      <script src="https://cdn.jsdelivr.net/npm/vega-lite@5"><\/script>
      <script src="https://cdn.jsdelivr.net/npm/vega-embed@6"><\/script>
      <script>vegaEmbed('#vega-chart', ${specJson})<\/script>`;
    return <HtmlOutput html={html} />;
  }

  // text/html handles Bokeh, pandas DataFrames, IPython.display.HTML, etc.
  if (data['text/html']) {
    return <HtmlOutput html={data['text/html'] as string} />;
  }
  if (data['image/png']) {
    return <ImageOutput src={data['image/png'] as string} type="png" />;
  }
  if (data['image/svg+xml']) {
    return <ImageOutput src={data['image/svg+xml'] as string} type="svg" />;
  }
  if (data['image/jpeg']) {
    return <ImageOutput src={data['image/jpeg'] as string} type="jpeg" />;
  }
  if (data['text/plain']) {
    const text = Array.isArray(data['text/plain'])
      ? (data['text/plain'] as string[]).join('')
      : (data['text/plain'] as string);
    return <TextOutput text={text} stream="stdout" />;
  }
  return <pre className="text-output">{JSON.stringify(data, null, 2)}</pre>;
}
