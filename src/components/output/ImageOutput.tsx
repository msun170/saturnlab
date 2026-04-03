import { useRef, useState, useEffect } from 'react';

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

  // Lazy decode: only build the data URI when the element is near the viewport
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }, // start loading 200px before visible
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    return (
      <div ref={ref} className="image-output-placeholder" style={{ minHeight: 100 }}>
        <span className="image-placeholder-text">Image loading...</span>
      </div>
    );
  }

  const dataUri = `data:image/${type};base64,${src}`;
  return (
    <div ref={ref}>
      <img src={dataUri} alt="Output" className="image-output" loading="lazy" decoding="async" />
    </div>
  );
}
