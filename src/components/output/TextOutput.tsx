interface TextOutputProps {
  text: string;
  stream: string;
}

export default function TextOutput({ text, stream }: TextOutputProps) {
  return (
    <pre className={`text-output ${stream === 'stderr' ? 'stderr' : ''}`}>
      {text}
    </pre>
  );
}
