import React, { useEffect, useRef, useState } from 'react';
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

type PublicState = {
  name: string;
  life: number;
  poison: number;
  handCount: number;
  libraryCount: number;
  battlefield: ReturnType<typeof useGame>['state']['localPlayer']['battlefield'];
  graveyard: ReturnType<typeof useGame>['state']['localPlayer']['graveyard'];
  exile: ReturnType<typeof useGame>['state']['localPlayer']['exile'];
  commandZone: ReturnType<typeof useGame>['state']['localPlayer']['commandZone'];
};

function toPublicState(lp: ReturnType<typeof useGame>['state']['localPlayer']): PublicState {
  return {
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
}

export default function GameBoard({ session, broadcast }: Props) {
  const { state, applyPeerEvent } = useGame();
  const lastWorkerStateTsRef = useRef<Record<string, number>>({});
  const pendingWorkerPostRef = useRef(true);
  const lastPostedHashRef = useRef('');
  const lastPostAtRef = useRef(0);
  const latestPublicStateRef = useRef<PublicState>(toPublicState(state.localPlayer));
  const [cardScale, setCardScale] = useState<number>(() => {
    const raw = localStorage.getItem('mtgg-card-scale');
    const parsed = raw ? Number(raw) : 1;
    return [0.9, 1, 1.2, 1.35, 1.5].includes(parsed) ? parsed : 1;
  });

  useEffect(() => {
    localStorage.setItem('mtgg-card-scale', String(cardScale));
  }, [cardScale]);

  useEffect(() => {
    latestPublicStateRef.current = toPublicState(state.localPlayer);
    pendingWorkerPostRef.current = true;
  }, [state.localPlayer]);

  useEffect(() => {
    const lp = state.localPlayer;
    const syncEvent: PeerEvent = {
      type: 'STATE_SYNC',
      state: toPublicState(lp),
    };

    broadcast(syncEvent);
    const timer = setInterval(() => broadcast(syncEvent), 1500);
    return () => clearInterval(timer);
  }, [state.localPlayer, broadcast]);

  useEffect(() => {
    let active = true;

    async function syncViaWorker() {
      if (!active) return;

      const publicState = latestPublicStateRef.current;
      const hasOpponents = state.opponents.length > 0;
      const now = Date.now();
      const stateHash = JSON.stringify(publicState);
      const shouldPost = hasOpponents && (
        pendingWorkerPostRef.current
        || stateHash !== lastPostedHashRef.current
        || (now - lastPostAtRef.current) > 15000
      );

      try {
        if (shouldPost) {
          await fetch(`${WORKER_URL}/rooms/${session.roomCode}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playerId: session.playerId,
              token: session.token,
              state: publicState,
            }),
          });

          pendingWorkerPostRef.current = false;
          lastPostedHashRef.current = stateHash;
          lastPostAtRef.current = now;
        }

        if (hasOpponents) {
          const res = await fetch(
            `${WORKER_URL}/rooms/${session.roomCode}/state?playerId=${session.playerId}&token=${session.token}`,
          );
          if (res.ok) {
            const data = await res.json() as {
              states?: Record<string, { state: PublicState; ts: number }>;
            };
            const states = data.states ?? {};
            for (const [playerId, wrappedState] of Object.entries(states)) {
              if (playerId === session.playerId) continue;

              const lastTs = lastWorkerStateTsRef.current[playerId] ?? 0;
              if (wrappedState.ts <= lastTs) continue;

              lastWorkerStateTsRef.current[playerId] = wrappedState.ts;
              applyPeerEvent(playerId, { type: 'STATE_SYNC', state: wrappedState.state });
            }
          }
        }
      } catch {
        // Ignore transient worker sync failures.
      }

      const nextDelay = document.visibilityState === 'hidden'
        ? 4500
        : hasOpponents
          ? (shouldPost ? 1300 : 2000)
          : 6000;

      if (active) setTimeout(syncViaWorker, nextDelay);
    }

    syncViaWorker();
    return () => { active = false; };
  }, [session.roomCode, session.playerId, session.token, applyPeerEvent, state.opponents.length]);

  return (
    <div className="game-shell" style={{ ['--card-scale' as string]: String(cardScale) }}>
      <header className="game-header">
        <div>
          <strong>Room</strong> {session.roomCode}
        </div>
        <div className="game-header-right">
          <strong>Turn Order:</strong>{' '}
          {state.turnOrder.length
            ? state.turnOrder
                .map(id => (id === session.playerId ? `${state.localPlayer.name || 'You'} (you)` : state.opponents.find(o => o.playerId === id)?.name || id))
                .join('  ->  ')
            : 'Not set'}
          <label className="card-size-control">
            Card Size
            <select value={cardScale} onChange={e => setCardScale(Number(e.target.value))}>
              <option value={0.9}>90%</option>
              <option value={1}>100%</option>
              <option value={1.2}>120%</option>
              <option value={1.35}>135%</option>
              <option value={1.5}>150%</option>
            </select>
          </label>
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
