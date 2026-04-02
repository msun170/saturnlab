import Convert from 'ansi-to-html';

const convert = new Convert({ fg: '#d4d4d4', bg: '#1e1e1e', newline: true });

interface ErrorOutputProps {
  ename: string;
  evalue: string;
  traceback: string[];
}

export default function ErrorOutput({ traceback }: ErrorOutputProps) {
  const html = traceback.map((line) => convert.toHtml(line)).join('\n');

  return (
    <pre
      className="error-output"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
