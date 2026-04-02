interface HtmlOutputProps {
  html: string;
}

export default function HtmlOutput({ html }: HtmlOutputProps) {
  const hasScript = /<script/i.test(html);

  if (!hasScript) {
    return (
      <div
        className="html-output"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Sandbox HTML that contains scripts (e.g., Bokeh)
  const srcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;font-family:sans-serif;color:#d4d4d4;background:#1a1a1a;}</style></head><body>${html}</body></html>`;

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="rich-html-output"
      style={{ width: '100%', border: 'none', minHeight: 200 }}
      onLoad={(e) => {
        const iframe = e.target as HTMLIFrameElement;
        const height = iframe.contentDocument?.body?.scrollHeight;
        if (height) iframe.style.height = `${height + 16}px`;
      }}
    />
  );
}
