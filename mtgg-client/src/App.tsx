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
import StartingHandModal from './components/StartingHandModal';

type Screen = 'home' | 'lobby' | 'dice' | 'game';

export default function App() {
  const { dispatch, applyPeerEvent, state } = useGame();
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<LocalSession | null>(null);
  const [topDeckEnabled, setTopDeckEnabled] = useState(false);
  const [showStartingHand, setShowStartingHand] = useState(false);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [selectingBottom, setSelectingBottom] = useState(false);
  const [selectedStartingIds, setSelectedStartingIds] = useState<string[]>([]);

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

  function handleGameStart(opponents: { id: string; name: string }[], topDeck: boolean) {
    if (!session) return;
    setTopDeckEnabled(topDeck);
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
    dispatch({ type: 'SET_PHASE', phase: 'game' });
    setScreen('game');
    setSelectedStartingIds([]);
    setMulliganCount(0);
    setSelectingBottom(false);

    if (topDeckEnabled) {
      setShowStartingHand(true);
    } else {
      dispatch({ type: 'DRAW_OPENING_HAND', count: 7 });
      setShowStartingHand(true);
    }

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

  function toggleStartingSelect(id: string) {
    setSelectedStartingIds(prev => prev.includes(id)
      ? prev.filter(x => x !== id)
      : [...prev, id]);
  }

  function handleKeepStartingHand() {
    if (mulliganCount <= 0) {
      setShowStartingHand(false);
      setSelectedStartingIds([]);
      return;
    }
    setSelectingBottom(true);
    setSelectedStartingIds([]);
  }

  function handleMulligan() {
    if (mulliganCount >= 7) return;
    dispatch({ type: 'MULLIGAN_RESET_DRAW', count: 7 });
    setMulliganCount(prev => Math.min(7, prev + 1));
    setSelectingBottom(false);
    setSelectedStartingIds([]);
  }

  function handleConfirmBottom() {
    if (selectedStartingIds.length !== mulliganCount) return;
    dispatch({ type: 'BOTTOM_HAND_CARDS', instanceIds: selectedStartingIds });
    setShowStartingHand(false);
    setSelectingBottom(false);
    setSelectedStartingIds([]);
  }

  function handleConfirmTopDeck() {
    if (selectedStartingIds.length !== 7) return;
    dispatch({ type: 'PICK_FROM_LIBRARY', instanceIds: selectedStartingIds });
    setShowStartingHand(false);
    setSelectedStartingIds([]);
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
        <>
          <GameBoard
            session={session}
            broadcast={broadcast}
          />
          {showStartingHand && (
            <StartingHandModal
              mode={topDeckEnabled ? 'topdeck' : 'normal'}
              hand={state.localPlayer.hand}
              library={state.localPlayer.library}
              mulliganCount={mulliganCount}
              selectingBottom={selectingBottom}
              selectedIds={selectedStartingIds}
              onToggleCard={toggleStartingSelect}
              onKeep={handleKeepStartingHand}
              onMulligan={handleMulligan}
              onConfirmBottom={handleConfirmBottom}
              onConfirmTopDeck={handleConfirmTopDeck}
            />
          )}
        </>
      )}
    </>
  );
}
