import React from 'react';
import type { PeerEvent } from '../types';
import { useGame } from '../context/GameContext';

interface Props {
  broadcast: (event: PeerEvent) => void;
}

export default function ZonePanel({ broadcast }: Props) {
  const { state, dispatch } = useGame();
  const lp = state.localPlayer;

  function draw() {
    if (!lp.library.length) return;
    dispatch({ type: 'DRAW_CARD' });
    broadcast({ type: 'UPDATE_COUNTS', handCount: lp.hand.length + 1, libraryCount: Math.max(0, lp.library.length - 1) });
  }

  function shuffle() {
    dispatch({ type: 'SHUFFLE_LIBRARY' });
  }

  function moveTopFromGraveyardToHand() {
    const top = lp.graveyard[lp.graveyard.length - 1];
    if (!top) return;
    dispatch({ type: 'MOVE_CARD', instanceId: top.instanceId, from: 'graveyard', to: 'hand' });
    broadcast({ type: 'MOVE_CARD', instanceId: top.instanceId, from: 'graveyard', to: 'hand' });
    broadcast({ type: 'UPDATE_COUNTS', handCount: lp.hand.length + 1, libraryCount: lp.library.length });
  }

  function moveTopFromExileToHand() {
    const top = lp.exile[lp.exile.length - 1];
    if (!top) return;
    dispatch({ type: 'MOVE_CARD', instanceId: top.instanceId, from: 'exile', to: 'hand' });
    broadcast({ type: 'MOVE_CARD', instanceId: top.instanceId, from: 'exile', to: 'hand' });
    broadcast({ type: 'UPDATE_COUNTS', handCount: lp.hand.length + 1, libraryCount: lp.library.length });
  }

  return (
    <aside className="zone-panel">
      <h3 className="zone-panel-title">Zones</h3>

      <div className="zone-box zone-library">
        <h4>Library</h4>
        <p className="zone-count">{lp.library.length}</p>
        <div className="zone-actions">
          <button className="btn btn-sm" onClick={draw}>Draw</button>
          <button className="btn btn-sm btn-ghost" onClick={shuffle}>Shuffle</button>
        </div>
      </div>

      <div className="zone-box zone-graveyard">
        <h4>Graveyard</h4>
        <p className="zone-count">{lp.graveyard.length}</p>
        <div className="zone-actions">
          <button className="btn btn-sm btn-ghost" disabled={!lp.graveyard.length} onClick={moveTopFromGraveyardToHand}>
            Top to Hand
          </button>
        </div>
      </div>

      <div className="zone-box zone-exile">
        <h4>Exile</h4>
        <p className="zone-count">{lp.exile.length}</p>
        <div className="zone-actions">
          <button className="btn btn-sm btn-ghost" disabled={!lp.exile.length} onClick={moveTopFromExileToHand}>
            Top to Hand
          </button>
        </div>
      </div>
    </aside>
  );
}
