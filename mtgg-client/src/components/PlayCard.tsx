import React from 'react';
import type { GameCard } from '../types';
import InspectOverlay from './InspectOverlay';

interface Props {
  card:          GameCard;
  /** True if rendered on the local-player battlefield (enables interactions). */
  interactive?:  boolean;
  onTap?:        (id: string) => void;
  onMouseDown?:  (e: React.MouseEvent, card: GameCard) => void;
  onContextMenu?:(e: React.MouseEvent, card: GameCard) => void;
  /** When true the card is shown as a dragging ghost (semi-transparent). */
  ghost?:        boolean;
  style?:        React.CSSProperties;
}

const CARD_W = 63;
const CARD_H = 88;

export default function PlayCard({
  card,
  interactive,
  onTap,
  onMouseDown,
  onContextMenu,
  ghost,
  style,
}: Props) {
  const cls = [
    'play-card',
    card.tapped      ? 'tapped'      : '',
    card.faceDown    ? 'face-down'   : '',
    ghost            ? 'ghost'       : '',
    interactive      ? 'interactive' : '',
  ].filter(Boolean).join(' ');

  const counterEntries = Object.entries(card.counters).filter(([, v]) => v !== 0);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (interactive && onTap) onTap(card.instanceId);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return; // left button only
    e.stopPropagation();
    onMouseDown?.(e, card);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e, card);
  }

  const cardContent = (
    <div
      className={cls}
      style={{ width: CARD_W, height: CARD_H, ...style }}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      {!card.faceDown && card.imageUri ? (
        <img
          src={card.imageUri}
          alt={card.name}
          className="play-card-img"
          draggable={false}
        />
      ) : (
        <div className="play-card-face-down" />
      )}

      {counterEntries.length > 0 && (
        <div className="counter-strip">
          {counterEntries.map(([type, val]) => (
            <span key={type} className="counter-badge" title={type}>
              {val > 0 ? '+' : ''}{val}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  // Wrap with inspect overlay (only when not a ghost/dragging)
  if (!ghost && card.imageUri) {
    return (
      <InspectOverlay imageUri={card.largeImageUri || card.imageUri} cardName={card.name}>
        {cardContent}
      </InspectOverlay>
    );
  }
  return cardContent;
}
