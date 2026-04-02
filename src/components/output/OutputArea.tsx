import type { Output } from '../../types/notebook';
import TextOutput from './TextOutput';
import ImageOutput from './ImageOutput';
import HtmlOutput from './HtmlOutput';
import ErrorOutput from './ErrorOutput';

interface OutputAreaProps {
  outputs: Output[];
}

export default function OutputArea({ outputs }: OutputAreaProps) {
  if (outputs.length === 0) return null;

  return (
    <div className="output-area">
      {outputs.map((output, i) => (
        <div key={i} className="output-row">
          {/* Out[n]: prompt for execute_result only, matching Jupyter */}
          {output.output_type === 'execute_result' && output.execution_count != null && (
            <div className="output-prompt">
              <span className="prompt-out">Out[{output.execution_count}]:</span>
            </div>
          )}
          <div className="output-content">
            <OutputRenderer output={output} />
          </div>
        </div>
      ))}
    </div>
  );
}

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

/** Render the richest available MIME type from a data bundle. */
function MimeRenderer({ data }: { data: Record<string, unknown> }) {
  // Priority order matching Jupyter's mime type precedence
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
