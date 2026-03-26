import React, { useState } from 'react';
import { WORKER_URL } from '../utils/helpers';
import type { LocalSession } from '../types';

interface Props {
  onSession: (session: LocalSession) => void;
}

export default function HomeScreen({ onSession }: Props) {
  const [mode, setMode]         = useState<'home' | 'host' | 'join'>('home');
  const [name, setName]         = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleHost(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Enter your name'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${WORKER_URL}/rooms`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hostName: name.trim(), password: password || undefined }),
      });
      const data = await res.json() as { code?: string; playerId?: string; token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create room');
      onSession({
        roomCode: data.code!,
        playerId: data.playerId!,
        token:    data.token!,
        playerName: name.trim(),
        isHost:   true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim())     { setError('Enter your name'); return; }
    if (!roomCode.trim()) { setError('Enter room code'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${WORKER_URL}/rooms/${roomCode.trim().toUpperCase()}/join`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ playerName: name.trim(), password: password || undefined }),
      });
      const data = await res.json() as { code?: string; playerId?: string; token?: string; hostId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to join room');
      onSession({
        roomCode:   data.code!,
        playerId:   data.playerId!,
        token:      data.token!,
        playerName: name.trim(),
        isHost:     false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="home-screen">
      <div className="home-card">
        <h1 className="home-title">MTGG</h1>
        <p className="home-subtitle">Commander — Digital Tabletop</p>

        {mode === 'home' && (
          <div className="home-buttons">
            <button className="btn btn-primary btn-large" onClick={() => setMode('host')}>Host Game</button>
            <button className="btn btn-secondary btn-large" onClick={() => setMode('join')}>Join Game</button>
          </div>
        )}

        {mode === 'host' && (
          <form onSubmit={handleHost} className="auth-form">
            <h2>Host a Game</h2>
            <label>Your name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Commander name" maxLength={24} autoFocus />
            </label>
            <label>Room password <span className="optional">(optional)</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank for open room" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setMode('home'); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Creating…' : 'Create Room'}
              </button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoin} className="auth-form">
            <h2>Join a Game</h2>
            <label>Your name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Commander name" maxLength={24} autoFocus />
            </label>
            <label>Room code
              <input
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="e.g. A3K7MX"
                maxLength={8}
                className="code-input"
              />
            </label>
            <label>Password <span className="optional">(if required)</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setMode('home'); setError(''); }}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Joining…' : 'Join Room'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
