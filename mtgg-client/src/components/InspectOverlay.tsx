import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface Props {
  imageUri:  string;
  cardName:  string;
  children:  React.ReactNode;
}

/** Wraps any element; shows a large card preview after hovering 600 ms. */
export default function InspectOverlay({ imageUri, cardName, children }: Props) {
  const [visible, setVisible]   = useState(false);
  const [pos, setPos]           = useState({ x: 0, y: 0 });
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef            = useRef<HTMLDivElement>(null);

  function handleMouseEnter(e: React.MouseEvent) {
    const x = e.clientX;
    const y = e.clientY;
    timerRef.current = setTimeout(() => {
      setPos({ x, y });
      setVisible(true);
    }, 600);
  }

  function handleMouseLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!visible) setPos({ x: e.clientX, y: e.clientY });
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Position the card to the right of the cursor, flip left if near edge
  const vw    = window.innerWidth;
  const cardW = 240;
  const cardH = 336;
  const gap   = 12;
  const left  = pos.x + gap + cardW > vw ? pos.x - cardW - gap : pos.x + gap;
  const top   = Math.max(8, Math.min(pos.y - cardH / 2, window.innerHeight - cardH - 8));

  return (
    <div
      ref={containerRef}
      style={{ display: 'contents' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      {children}
      {visible && imageUri && ReactDOM.createPortal(
        <div className="inspect-overlay" style={{ left, top }}>
          <img
            src={imageUri}
            alt={cardName}
            className="inspect-image"
            draggable={false}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
