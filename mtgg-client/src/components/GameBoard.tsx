import React, { useEffect } from 'react';
import type { LocalSession, PeerEvent } from '../types';
import { useGame } from '../context/GameContext';
import { WORKER_URL } from '../utils/helpers';
import OpponentArea from './OpponentArea';
import PlayerArea from './PlayerArea';
import ZonePanel from './ZonePanel';

interface Props {
  session: LocalSession;
  broadcast: (event: PeerEvent) => void;
}

export default function GameBoard({ session, broadcast }: Props) {
  const { state, applyPeerEvent } = useGame();

  useEffect(() => {
    const lp = state.localPlayer;
    const syncEvent: PeerEvent = {
      type: 'STATE_SYNC',
      state: {
        name: lp.name,
        life: lp.life,
        poison: lp.poison,
        handCount: lp.hand.length,
        libraryCount: lp.library.length,
        battlefield: lp.battlefield,
        graveyard: lp.graveyard,
        exile: lp.exile,
        commandZone: lp.commandZone,
      },
    };

    broadcast(syncEvent);
    const timer = setInterval(() => broadcast(syncEvent), 1500);
    return () => clearInterval(timer);
  }, [state.localPlayer, broadcast]);

  useEffect(() => {
    let active = true;

    async function syncViaWorker() {
      if (!active) return;

      const lp = state.localPlayer;
      const publicState = {
        name: lp.name,
        life: lp.life,
        poison: lp.poison,
        handCount: lp.hand.length,
        libraryCount: lp.library.length,
        battlefield: lp.battlefield,
        graveyard: lp.graveyard,
        exile: lp.exile,
        commandZone: lp.commandZone,
      };

      try {
        await fetch(`${WORKER_URL}/rooms/${session.roomCode}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: session.playerId,
            token: session.token,
            state: publicState,
          }),
        });

        const res = await fetch(
          `${WORKER_URL}/rooms/${session.roomCode}/state?playerId=${session.playerId}&token=${session.token}`,
        );
        if (res.ok) {
          const data = await res.json() as { states?: Record<string, typeof publicState> };
          const states = data.states ?? {};
          for (const [playerId, oppState] of Object.entries(states)) {
            if (playerId === session.playerId) continue;
            applyPeerEvent(playerId, { type: 'STATE_SYNC', state: oppState });
          }
        }
      } catch {
        // Ignore transient worker sync failures.
      }

      if (active) setTimeout(syncViaWorker, 900);
    }

    syncViaWorker();
    return () => { active = false; };
  }, [session.roomCode, session.playerId, session.token, state.localPlayer, applyPeerEvent]);

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
