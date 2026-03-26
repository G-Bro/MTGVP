import React, { useState, useCallback, useRef } from 'react';
import type { LocalSession, PeerEvent } from './types';
import { WORKER_URL } from './utils/helpers';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { useGame } from './context/GameContext';
import HomeScreen from './components/HomeScreen';
import Lobby from './components/Lobby';
import DiceRoll from './components/DiceRoll';
import GameBoard from './components/GameBoard';

type Screen = 'home' | 'lobby' | 'dice' | 'game';

export default function App() {
  const { dispatch, applyPeerEvent, state } = useGame();
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<LocalSession | null>(null);

  // Keep session in a ref so sendSignal never captures a stale closure
  const sessionRef = useRef<LocalSession | null>(null);
  sessionRef.current = session;

  // sendSignal is stable — no deps — reads session via ref
  const sendSignal = useCallback(
    async (args: { toId: string; type: 'offer' | 'answer' | 'ice-candidate'; payload: unknown }) => {
      const s = sessionRef.current;
      if (!s) return;
      try {
        await fetch(`${WORKER_URL}/rooms/${s.roomCode}/signal`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ fromId: s.playerId, token: s.token, ...args }),
        });
      } catch { /* ignore transient network failures */ }
    },
    [],
  );

  const { connectToPeer, handleSignals, broadcast } = useWebRTC({
    localPlayerId: session?.playerId ?? '',
    onPeerEvent:   applyPeerEvent,
    sendSignal,
  });

  useSignaling({
    roomCode: session?.roomCode ?? '',
    playerId: session?.playerId ?? '',
    token:    session?.token    ?? '',
    enabled:  !!session,
    onSignals: handleSignals,
  });

  // ── Screen transitions ────────────────────────────────────────────────────

  function handleSession(s: LocalSession) {
    setSession(s);
    setScreen('lobby');
  }

  function handleGameStart(opponents: { id: string; name: string }[]) {
    if (!session) return;
    dispatch({
      type: 'INIT_GAME',
      localPlayerId: session.playerId,
      localName:     session.playerName,
      opponents,
    });
    dispatch({ type: 'SET_PHASE', phase: 'dice' });
    setScreen('dice');
  }

  function handleOrderSet() {
    dispatch({ type: 'DRAW_OPENING_HAND', count: 7 });
    dispatch({ type: 'SET_PHASE', phase: 'game' });
    setScreen('game');

    // Broadcast our full public state to peers so they can populate our opponent slot
    const lp = state.localPlayer;
    const syncEvent: PeerEvent = {
      type:  'STATE_SYNC',
      state: {
        name:         lp.name,
        life:         lp.life,
        poison:       lp.poison,
        handCount:    lp.hand.length,
        libraryCount: lp.library.length,
        battlefield:  lp.battlefield,
        graveyard:    lp.graveyard,
        exile:        lp.exile,
        commandZone:  lp.commandZone,
      },
    };
    broadcast(syncEvent);
  }

  return (
    <>
      {screen === 'home' && (
        <HomeScreen onSession={handleSession} />
      )}
      {screen === 'lobby' && session && (
        <Lobby
          session={session}
          connectToPeer={connectToPeer}
          onGameStart={handleGameStart}
        />
      )}
      {screen === 'dice' && session && (
        <DiceRoll
          session={session}
          broadcast={broadcast}
          onOrderSet={handleOrderSet}
        />
      )}
      {screen === 'game' && session && (
        <GameBoard
          session={session}
          broadcast={broadcast}
        />
      )}
    </>
  );
}
