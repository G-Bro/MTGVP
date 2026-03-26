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
  const [commanderOptions, setCommanderOptions] = useState<string[]>([]);
  const [selectedCommander, setSelectedCommander] = useState('');
  const [loadedCards, setLoadedCards] = useState<GameCard[]>([]);

  const lockedDeckRef = useRef<{ library: GameCard[]; commandZone: GameCard[] } | null>(null);

  const connectedPeers = useRef<Set<string>>(new Set());
  const connectingPeers = useRef<Set<string>>(new Set());
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
          const myRecord = data.players?.find(x => x.id === session.playerId);
          const shouldInitiate = !!myRecord && p.joinedAt < myRecord.joinedAt;
          if (shouldInitiate && !connectedPeers.current.has(p.id) && !connectingPeers.current.has(p.id)) {
            connectingPeers.current.add(p.id);
            connectToPeer(p.id)
              .then(() => {
                connectedPeers.current.add(p.id);
              })
              .catch(() => {
                // Retry on next poll if offer creation/signaling failed.
              })
              .finally(() => {
                connectingPeers.current.delete(p.id);
              });
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
    const text = session.roomCode;
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

    const commanderFromSection = parsed.commander
      .map(e => e.name)
      .filter((name, i, arr) => arr.indexOf(name) === i);

    // Autodetect fallback when no Commander section is present.
    const nameCounts = new Map<string, number>();
    for (const entry of allEntries) {
      nameCounts.set(entry.name.toLowerCase(), (nameCounts.get(entry.name.toLowerCase()) ?? 0) + entry.quantity);
    }

    const autodetected = cards
      .filter(c => {
        const type = c.typeLine.toLowerCase();
        const isLegendary = type.includes('legendary');
        const canBeCommander = type.includes('creature') || type.includes('planeswalker');
        const singleCopy = (nameCounts.get(c.name.toLowerCase()) ?? 0) === 1;
        return isLegendary && canBeCommander && singleCopy;
      })
      .map(c => c.name)
      .filter((name, i, arr) => arr.indexOf(name) === i);

    const options = commanderFromSection.length ? commanderFromSection : autodetected;
    setCommanderOptions(options);

    const picked = commanderFromSection.length
      ? commanderFromSection[0]
      : (autodetected[0] ?? '');
    setSelectedCommander(picked);

    const { library, commandZone } = splitDeckForCommander(cards, picked);
    setLoadedCards(cards);

    lockedDeckRef.current = { library, commandZone };
    dispatch({ type: 'LOAD_DECK', library, commandZone });

    if (!picked) {
      setDeckError('No commander detected. Select one manually from your list.');
    } else if (!commanderFromSection.length && autodetected.length > 1) {
      setDeckError('Multiple possible commanders detected. Select the correct one.');
    } else {
      setDeckError('');
    }

    setDeckStatus('ready');
  }

  useEffect(() => {
    if (deckStatus !== 'ready' || !loadedCards.length) return;
    const { library, commandZone } = splitDeckForCommander(loadedCards, selectedCommander);
    lockedDeckRef.current = { library, commandZone };
    dispatch({ type: 'LOAD_DECK', library, commandZone });
  }, [selectedCommander, deckStatus, loadedCards, dispatch]);

  async function lockDeck() {
    if (deckStatus !== 'ready') return;
    if (!selectedCommander) {
      setDeckError('Choose a commander before locking in.');
      return;
    }
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
                {deckStatus === 'ready' && commanderOptions.length > 1 && (
                  <label className="commander-select-wrap">
                    Commander
                    <select
                      className="commander-select"
                      value={selectedCommander}
                      onChange={e => setSelectedCommander(e.target.value)}
                    >
                      <option value="">Select commander…</option>
                      {commanderOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                )}
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

function splitDeckForCommander(cards: GameCard[], commanderName: string): { library: GameCard[]; commandZone: GameCard[] } {
  if (!commanderName) {
    return { library: shuffle([...cards]), commandZone: [] };
  }

  const index = cards.findIndex(c => c.name.toLowerCase() === commanderName.toLowerCase());
  if (index < 0) return { library: shuffle([...cards]), commandZone: [] };

  const commanderCard = {
    ...cards[index],
    position: { x: 6, y: 10 },
  };

  const library = shuffle(cards.filter((_, i) => i !== index));
  return { library, commandZone: [commanderCard] };
}
