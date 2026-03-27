import React, { useMemo, useState } from 'react';
import type { GameCard } from '../types';

interface Props {
  mode: 'normal' | 'topdeck';
  hand: GameCard[];
  library: GameCard[];
  mulliganCount: number;
  selectingBottom: boolean;
  selectedIds: string[];
  onToggleCard: (id: string) => void;
  onKeep: () => void;
  onMulligan: () => void;
  onConfirmBottom: () => void;
  onConfirmTopDeck: () => void;
}

export default function StartingHandModal({
  mode,
  hand,
  library,
  mulliganCount,
  selectingBottom,
  selectedIds,
  onToggleCard,
  onKeep,
  onMulligan,
  onConfirmBottom,
  onConfirmTopDeck,
}: Props) {
  const [search, setSearch] = useState('');

  const cards = mode === 'normal' ? hand : library;
  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(c => c.name.toLowerCase().includes(q));
  }, [cards, search]);

  const required = mode === 'normal' ? (selectingBottom ? mulliganCount : 0) : 7;
  const title = mode === 'normal' ? 'Starting Hand' : 'Top Deck Setup';

  return (
    <div className="starting-hand-backdrop">
      <div className="starting-hand-modal">
        <h2>{title}</h2>

        {mode === 'normal' ? (
          <p className="hint">
            {selectingBottom
              ? `Choose ${mulliganCount} card${mulliganCount === 1 ? '' : 's'} to put on the bottom of your library.`
              : `Review your opening 7. Mulligans taken: ${mulliganCount}`}
          </p>
        ) : (
          <p className="hint">Search your library and select exactly 7 cards for your starting hand.</p>
        )}

        {mode === 'topdeck' && (
          <input
            className="topdeck-search"
            placeholder="Search cards by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}

        <div className="starting-card-grid">
          {filteredCards.map(card => {
            const selected = selectedIds.includes(card.instanceId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className={`starting-card-btn ${selected ? 'selected' : ''}`}
                onClick={() => onToggleCard(card.instanceId)}
              >
                <img src={card.imageUri} alt={card.name} className="starting-card-img" draggable={false} />
                <span className="starting-card-name">{card.name}</span>
              </button>
            );
          })}
        </div>

        <div className="starting-hand-footer">
          <span className="hint">Selected: {selectedIds.length}{required ? ` / ${required}` : ''}</span>

          {mode === 'normal' && !selectingBottom && (
            <>
              <button className="btn btn-secondary" onClick={onMulligan} disabled={mulliganCount >= 7}>
                Mulligan
              </button>
              <button className="btn btn-primary" onClick={onKeep}>
                Keep
              </button>
            </>
          )}

          {mode === 'normal' && selectingBottom && (
            <button
              className="btn btn-primary"
              onClick={onConfirmBottom}
              disabled={selectedIds.length !== mulliganCount}
            >
              Confirm Bottom Cards
            </button>
          )}

          {mode === 'topdeck' && (
            <button
              className="btn btn-primary"
              onClick={onConfirmTopDeck}
              disabled={selectedIds.length !== 7}
            >
              Confirm Starting 7
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
