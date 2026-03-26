import React, { useState, useEffect, useRef } from 'react';
import type { LocalSession, LobbyPlayer, GameCard, ParsedDeck } from '../types';
import { parseDeck } from '../utils/deckParser';
import { fetchCardsByName, expandDeckToCards } from '../utils/scryfall';
import { shuffle, WORKER_URL } from '../utils/helpers';
import { useGame } from '../context/GameContext';

interface Props {
  session: LocalSession;
  connectToPeer: (peerId: string) => Promise<void>;
  onGameStart: (opponents: { id: string; name: string }[]) => void;
}

const POLL_ROOM_MS = 2500;

export default function Lobby({ session, connectToPeer, onGameStart }: Props) {
  const { dispatch } = useGame();

  const [players, setPlayers]         = useState<LobbyPlayer[]>([]);
  const [hostId, setHostId]           = useState('');
  const [deckText, setDeckText]       = useState('');
  const [deckStatus, setDeckStatus]   = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [deckError, setDeckError]     = useState('');
  const [deckLocked, setDeckLocked]   = useState(false);
  const [shareMsg, setShareMsg]       = useState('');

  const lockedDeckRef = useRef<{ library: GameCard[]; commandZone: GameCard[] } | null>(null);

  const connectedPeers = useRef<Set<string>>(new Set());
  const gameStartedRef  = useRef(false);

  useEffect(() => {
    let active = true;

    async function pollRoom() {
      if (!active) return;
      try {
        const res  = await fetch(`${WORKER_URL}/rooms/${session.roomCode}`);
        if (!res.ok) return;
        const data = await res.json() as { players?: LobbyPlayer[]; hostId?: string; status?: string };
        setPlayers(data.players ?? []);
        setHostId(data.hostId ?? '');

        for (const p of data.players ?? []) {
          if (p.id === session.playerId) continue;
          if (!connectedPeers.current.has(p.id)) {
            connectedPeers.current.add(p.id);
            const myRecord = data.players?.find(x => x.id === session.playerId);
            if (myRecord && p.joinedAt < myRecord.joinedAt) {
              connectToPeer(p.id);
            }
          }
        }

        if (data.status === 'started' && !gameStartedRef.current) {
          gameStartedRef.current = true;
          const opponents = (data.players ?? [])
            .filter(p => p.id !== session.playerId)
            .map(p => ({ id: p.id, name: p.name }));
          onGameStart(opponents);
          return;
        }
      } catch { /* ignore network errors */ }
      if (active) setTimeout(pollRoom, POLL_ROOM_MS);
    }

    pollRoom();
    return () => { active = false; };
  }, [session, connectToPeer, onGameStart]);

  async function copyShareInfo() {
    const text = `Room code: ${session.roomCode}`;
    await navigator.clipboard.writeText(text);
    setShareMsg('Copied!');
    setTimeout(() => setShareMsg(''), 2000);
  }

  async function loadDeck() {
    if (!deckText.trim()) { setDeckError('Paste your decklist first'); return; }
    setDeckStatus('loading'); setDeckError('');

    const parsed: ParsedDeck = parseDeck(deckText);
    const allEntries = [...parsed.commander, ...parsed.main];
    const uniqueNames = [...new Set(allEntries.map(e => e.name))];

    const fetchResult = await fetchCardsByName(uniqueNames);
    const { cards, notFound } = expandDeckToCards(fetchResult, allEntries);

    if (notFound.length) {
      setDeckError(`Could not find: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? ` (+${notFound.length - 5} more)` : ''}`);
      setDeckStatus('error');
      return;
    }

    const commandZone = cards.filter((_, i) => allEntries[i]?.isCommander);
    const library     = shuffle(cards.filter((_, i) => !allEntries[i]?.isCommander));

    lockedDeckRef.current = { library, commandZone };
    dispatch({ type: 'LOAD_DECK', library, commandZone });
    setDeckStatus('ready');
  }

  async function lockDeck() {
    if (deckStatus !== 'ready') return;
    try {
      await fetch(`${WORKER_URL}/rooms/${session.roomCode}/ready`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ playerId: session.playerId, token: session.token, deckLocked: true }),
      });
      setDeckLocked(true);
    } catch {
      setDeckError('Failed to notify server. Try again.');
    }
  }

  async function startGame() {
    try {
      const res  = await fetch(`${WORKER_URL}/rooms/${session.roomCode}/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ playerId: session.playerId, token: session.token }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { alert(data.error); return; }

      // non-host players detect start via polling; host transitions immediately
      const opponents = players
        .filter(p => p.id !== session.playerId)
        .map(p => ({ id: p.id, name: p.name }));
      gameStartedRef.current = true;
      onGameStart(opponents);
    } catch {
      alert('Network error — could not start game.');
    }
  }

  const allLocked     = players.length >= 2 && players.every(p => p.deckLocked);
  const isHost        = session.playerId === hostId;

  return (
    <div className="lobby-screen">
      <div className="lobby-header">
        <h2>Lobby</h2>
        <div className="room-code-display">
          <span>Room:</span>
          <strong className="room-code">{session.roomCode}</strong>
          <button className="btn btn-ghost btn-sm" onClick={copyShareInfo}>
            {shareMsg || 'Copy'}
          </button>
        </div>
      </div>

      <div className="lobby-body">
        {/* Player list */}
        <div className="player-list">
          <h3>Players ({players.length}/4)</h3>
          {players.map(p => (
            <div key={p.id} className={`player-row ${p.deckLocked ? 'player-ready' : ''}`}>
              <span className="player-name">
                {p.name}
                {p.id === hostId && <span className="badge">HOST</span>}
                {p.id === session.playerId && <span className="badge badge-you">YOU</span>}
              </span>
              <span className={`player-status ${p.deckLocked ? 'ready' : 'waiting'}`}>
                {p.deckLocked ? '✓ Ready' : 'Waiting…'}
              </span>
            </div>
          ))}
          {players.length < 2 && (
            <p className="waiting-msg">Waiting for at least 1 more player to join…</p>
          )}
        </div>

        {/* Deck import */}
        <div className="deck-import">
          <h3>Import Deck</h3>
          <p className="hint">Paste a Moxfield / MTGO / Arena export below.</p>
          <textarea
            className="deck-textarea"
            value={deckText}
            onChange={e => setDeckText(e.target.value)}
            placeholder={"Commander (1)\n1 Atraxa, Praetors' Voice\n\nLands (37)\n1 Command Tower\n…"}
            disabled={deckLocked}
            rows={12}
          />
          {deckError && <p className="form-error">{deckError}</p>}
          <div className="deck-actions">
            {!deckLocked && (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={loadDeck}
                  disabled={deckStatus === 'loading'}
                >
                  {deckStatus === 'loading' ? 'Fetching cards…' : 'Load Deck'}
                </button>
                {deckStatus === 'ready' && (
                  <button className="btn btn-primary" onClick={lockDeck}>
                    Lock In
                  </button>
                )}
              </>
            )}
            {deckLocked && <p className="deck-locked-msg">✓ Deck locked in</p>}
          </div>
        </div>
      </div>

      {isHost && (
        <div className="lobby-footer">
          <button
            className="btn btn-primary btn-large"
            onClick={startGame}
            disabled={!allLocked}
            title={!allLocked ? 'All players must lock in a deck first' : ''}
          >
            Start Game
          </button>
          {!allLocked && <p className="hint">All players must lock in before you can start.</p>}
        </div>
      )}
      {!isHost && (
        <div className="lobby-footer">
          <p className="hint">Waiting for the host to start the game…</p>
        </div>
      )}
    </div>
  );
}
