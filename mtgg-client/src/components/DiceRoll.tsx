import React, { useState, useEffect } from 'react';
import type { LocalSession, PeerEvent } from '../types';
import { rollDie } from '../utils/helpers';
import { WORKER_URL } from '../utils/helpers';
import { useGame } from '../context/GameContext';

interface Props {
  session:   LocalSession;
  broadcast: (event: PeerEvent) => void;
  onOrderSet: () => void;
}

export default function DiceRoll({ session, broadcast, onOrderSet }: Props) {
  const { state, dispatch } = useGame();
  const [rolled, setRolled]     = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [syncError, setSyncError] = useState('');

  const allPlayerIds = [
    session.playerId,
    ...state.opponents.map(o => o.playerId),
  ];

  const playerName = (id: string) =>
    id === session.playerId
      ? state.localPlayer.name
      : state.opponents.find(o => o.playerId === id)?.name ?? id;

  // When all players have rolled, determine order
  useEffect(() => {
    if (ordering) return;
    const rollCount = Object.keys(state.diceRolls).length;
    if (rollCount < allPlayerIds.length || rollCount === 0) return;

    setOrdering(true);

    // Sort highest roll first; ties keep original join order as tiebreak
    const sorted = [...allPlayerIds].sort((a, b) => {
      const ra = state.diceRolls[a] ?? 0;
      const rb = state.diceRolls[b] ?? 0;
      return rb - ra;
    });

    dispatch({ type: 'SET_TURN_ORDER', order: sorted });

    // Brief pause so players can see results before transitioning
    setTimeout(onOrderSet, 2200);
  }, [state.diceRolls, allPlayerIds.length, ordering, dispatch, onOrderSet, allPlayerIds]);

  function handleRoll() {
    if (rolled) return;
    const value = rollDie(20);
    dispatch({ type: 'RECORD_DICE_ROLL', playerId: session.playerId, value });
    broadcast({ type: 'DICE_ROLL', value });
    fetch(`${WORKER_URL}/rooms/${session.roomCode}/dice`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        token: session.token,
        value,
      }),
    })
      .then(res => {
        if (!res.ok) {
          setSyncError('Dice sync endpoint failed. Make sure latest Worker is deployed.');
        }
      })
      .catch(() => {
        setSyncError('Dice sync endpoint unreachable. Check Worker deployment/URL.');
      });
    setRolled(true);
  }

  const allRolled    = allPlayerIds.every(id => state.diceRolls[id] !== undefined);
  const sortedByRoll = [...allPlayerIds].sort(
    (a, b) => (state.diceRolls[b] ?? -1) - (state.diceRolls[a] ?? -1),
  );

  // DataChannels can come online slightly after entering this screen.
  // Re-broadcast our roll until everyone has rolled so late peers catch it.
  useEffect(() => {
    const myRoll = state.diceRolls[session.playerId];
    if (myRoll === undefined || allRolled) return;

    const timer = setInterval(() => {
      broadcast({ type: 'DICE_ROLL', value: myRoll });
    }, 1200);

    return () => clearInterval(timer);
  }, [state.diceRolls, session.playerId, allRolled, broadcast]);

  // Poll authoritative room state so dice sync follows the same path as lobby readiness.
  useEffect(() => {
    let active = true;

    async function pollDice() {
      if (!active) return;
      try {
        const res = await fetch(`${WORKER_URL}/rooms/${session.roomCode}`);
        if (res.ok) {
          const data = await res.json() as { diceRolls?: Record<string, number> };
          const rolls = data.diceRolls ?? {};
          for (const [playerId, value] of Object.entries(rolls)) {
            if (state.diceRolls[playerId] !== value) {
              dispatch({ type: 'RECORD_DICE_ROLL', playerId, value });
            }
          }
        }
      } catch {
        // ignore transient poll failures
      }
      if (active && !allRolled) {
        const delay = document.visibilityState === 'hidden' ? 3500 : 1800;
        setTimeout(pollDice, delay);
      }
    }

    pollDice();
    return () => { active = false; };
  }, [session.roomCode, session.playerId, session.token, allRolled, dispatch, state.diceRolls]);

  return (
    <div className="dice-roll-screen">
      <h2>Roll for Turn Order</h2>
      <p className="hint">Highest roll goes first. Roll your d20!</p>

      <div className="dice-results">
        {sortedByRoll.map((id, rank) => {
          const val  = state.diceRolls[id];
          const isMe = id === session.playerId;
          return (
            <div key={id} className={`dice-row ${isMe ? 'dice-row-me' : ''} ${val !== undefined ? 'dice-row-done' : ''}`}>
              <span className="dice-rank">{val !== undefined ? `#${rank + 1}` : '—'}</span>
              <span className="dice-name">{playerName(id)}{isMe ? ' (you)' : ''}</span>
              <span className="dice-value">{val !== undefined ? `🎲 ${val}` : 'Waiting…'}</span>
            </div>
          );
        })}
      </div>

      {!rolled && (
        <button className="btn btn-primary btn-large roll-btn" onClick={handleRoll}>
          Roll d20
        </button>
      )}

      {rolled && !allRolled && (
        <p className="hint">Waiting for all players to roll…</p>
      )}

      {syncError && (
        <p className="form-error">{syncError}</p>
      )}

      {allRolled && (
        <p className="hint all-rolled">
          All rolled — starting game…
        </p>
      )}
    </div>
  );
}
