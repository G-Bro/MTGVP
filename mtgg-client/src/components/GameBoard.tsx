import React from 'react';
import type { LocalSession, PeerEvent } from '../types';
import { useGame } from '../context/GameContext';
import OpponentArea from './OpponentArea';
import PlayerArea from './PlayerArea';
import ZonePanel from './ZonePanel';

interface Props {
  session: LocalSession;
  broadcast: (event: PeerEvent) => void;
}

export default function GameBoard({ session, broadcast }: Props) {
  const { state } = useGame();

  return (
    <div className="game-shell">
      <header className="game-header">
        <div>
          <strong>Room</strong> {session.roomCode}
        </div>
        <div>
          <strong>Turn Order:</strong>{' '}
          {state.turnOrder.length
            ? state.turnOrder
                .map(id => (id === session.playerId ? `${state.localPlayer.name || 'You'} (you)` : state.opponents.find(o => o.playerId === id)?.name || id))
                .join('  ->  ')
            : 'Not set'}
        </div>
      </header>

      <div className="game-grid">
        <section className="opponents-row">
          {state.opponents.length === 0 ? (
            <div className="empty-opponents">No opponents connected yet.</div>
          ) : (
            state.opponents.map(opp => (
              <OpponentArea key={opp.playerId} opponent={opp} />
            ))
          )}
        </section>

        <section className="local-player-row">
          <PlayerArea broadcast={broadcast} />
        </section>

        <section className="zones-col">
          <ZonePanel broadcast={broadcast} />
        </section>
      </div>
    </div>
  );
}
