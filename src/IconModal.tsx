import { useState, useEffect, useMemo, useCallback, memo } from 'react';

interface Icon {
  name: string;
  content: string;
}

interface Props {
  icon: Icon;
  onClose: () => void;
}

// Pre-compiled regex for better performance
const FILL_REGEX = /fill="[^"]*"/g;
const WIDTH_REGEX = /width="[^"]*"/;
const HEIGHT_REGEX = /height="[^"]*"/;

function IconModal({ icon, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(64);

  // Optimized SVG transformation
  const svg = useMemo(() => {
    let s = icon.content;

    // Handle fill
    if (s.includes('fill=')) {
      s = s.replace(FILL_REGEX, `fill="${color}"`);
    } else {
      s = s.replace('<svg', `<svg fill="${color}"`);
    }

    // Handle dimensions
    const hasWidth = WIDTH_REGEX.test(s);
    const hasHeight = HEIGHT_REGEX.test(s);

    if (hasWidth) {
      s = s.replace(WIDTH_REGEX, `width="${size}"`);
    }
    if (hasHeight) {
      s = s.replace(HEIGHT_REGEX, `height="${size}"`);
    }
    if (!hasWidth && !hasHeight) {
      s = s.replace('<svg', `<svg width="${size}" height="${size}"`);
    }

    return s;
  }, [icon.content, color, size]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(svg);
    setCopied(true);
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [svg]);

  const download = useCallback(() => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${icon.name}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [svg, icon.name]);

  // Keyboard handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setColor(e.target.value);
    },
    []
  );

  const handleSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSize(Number(e.target.value));
    },
    []
  );

  const stopPropagation = useCallback(
    (e: React.MouseEvent) => e.stopPropagation(),
    []
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={stopPropagation}>
        <div className="modal-header">
          <h3>{icon.name}</h3>
          <button onClick={onClose}>×</button>
        </div>

        <div className="modal-preview">
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>

        <div className="modal-controls">
          <div className="control">
            <label>Color</label>
            <input type="color" value={color} onChange={handleColorChange} />
            <input
              type="text"
              value={color}
              onChange={handleColorChange}
              className="color-input"
            />
          </div>
          <div className="control">
            <label>Size</label>
            <input
              type="range"
              min="16"
              max="256"
              value={size}
              onChange={handleSizeChange}
            />
            <span>{size}px</span>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy SVG'}</button>
          <button onClick={download}>Download</button>
        </div>
      </div>
    </div>
  );
}

export default memo(IconModal);





