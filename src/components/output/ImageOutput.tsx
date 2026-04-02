interface ImageOutputProps {
  src: string;
  type: 'png' | 'jpeg' | 'svg';
}

export default function ImageOutput({ src, type }: ImageOutputProps) {
  if (type === 'svg') {
    return (
      <div
        className="image-output"
        dangerouslySetInnerHTML={{ __html: src }}
      />
    );
  }

  const dataUri = `data:image/${type};base64,${src}`;
  return <img src={dataUri} alt="Output" className="image-output" loading="lazy" />;
}
