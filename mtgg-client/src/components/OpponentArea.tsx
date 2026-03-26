import React from 'react';
import type { OpponentState, GameCard } from '../types';
import PlayCard from './PlayCard';
import InspectOverlay from './InspectOverlay';

interface Props {
  opponent: OpponentState;
}

export default function OpponentArea({ opponent }: Props) {
  return (
    <div className="opponent-area">
      {/* Header bar */}
      <div className="opp-header">
        <span className="opp-name">{opponent.name}</span>
        <span className="opp-stat" title="Life">❤ {opponent.life}</span>
        {opponent.poison > 0 && (
          <span className="opp-stat opp-poison" title="Poison">☠ {opponent.poison}</span>
        )}
        <span className="opp-stat" title="Hand">🤚 {opponent.handCount}</span>
        <span className="opp-stat" title="Library">📚 {opponent.libraryCount}</span>
        {opponent.graveyard.length > 0 && (
          <span className="opp-stat" title="Graveyard">🪦 {opponent.graveyard.length}</span>
        )}
        {opponent.exile.length > 0 && (
          <span className="opp-stat" title="Exile">⬡ {opponent.exile.length}</span>
        )}
        {opponent.commandZone.length > 0 && (
          <span className="opp-stat" title="Command zone">⚜ {opponent.commandZone.length}</span>
        )}
      </div>

      {/* Command zone */}
      {opponent.commandZone.length > 0 && (
        <div className="opp-command-zone">
          {opponent.commandZone.map(card => (
            <OppCard key={card.instanceId} card={card} />
          ))}
        </div>
      )}

      {/* Battlefield – cards absolutely positioned */}
      <div className="opp-battlefield">
        {opponent.battlefield.map(card => (
          <div
            key={card.instanceId}
            className="opp-card-wrapper"
            style={{
              left:      `${card.position.x}%`,
              top:       `${card.position.y}%`,
              transform: card.tapped ? 'rotate(90deg)' : 'none',
            }}
          >
            <OppCard card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OppCard({ card }: { card: GameCard }) {
  return (
    <InspectOverlay imageUri={card.largeImageUri || card.imageUri} cardName={card.name}>
      <div className="opp-card">
        {card.imageUri ? (
          <img src={card.imageUri} alt={card.name} className="play-card-img" draggable={false} />
        ) : (
          <div className="play-card-face-down" />
        )}
      </div>
    </InspectOverlay>
  );
}
