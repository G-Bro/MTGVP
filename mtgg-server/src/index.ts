/**
 * MTGG Signalling Worker
 *
 * Responsibilities:
 *   1. Room lifecycle  – create, join, ready, start
 *   2. Signal relay    – WebRTC offer / answer / ICE-candidate exchange
 *   3. Room state poll – clients poll GET /rooms/:code to detect new players
 *
 * All game events during play travel exclusively over WebRTC DataChannels.
 * This Worker is only contacted during the lobby / handshake phase, so
 * request volume stays well within the 100 k/day free tier.
 *
 * Storage: Cloudflare KV
 *   room:{CODE}                 → RoomData          (TTL 8 h)
 *   signals:{CODE}:{PLAYER_ID}  → SignalEnvelope[]  (TTL 2 min)
 */

export interface Env {
  ROOMS: KVNamespace;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerRecord {
  id: string;
  token: string;   // opaque secret issued on create/join; used to auth later calls
  name: string;
  ready: boolean;
  deckLocked: boolean;
  joinedAt: number;
}

interface RoomData {
  code: string;
  hostId: string;
  passwordHash: string | null;
  players: PlayerRecord[];
  status: 'lobby' | 'started' | 'ended';
  diceRolls: Record<string, number>;
  createdAt: number;
}

type SignalType = 'offer' | 'answer' | 'ice-candidate';

interface SignalEnvelope {
  id: string;
  fromId: string;
  type: SignalType;
  payload: unknown;
  ts: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOM_TTL    = 8 * 60 * 60; // 8 hours in seconds
const SIGNAL_TTL  = 120;          // 2 minutes in seconds
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRoomCode(): string {
  // Unambiguous alphabet (no O/0, I/1)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function generateId(): string {
  return crypto.randomUUID();
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ─── KV helpers ───────────────────────────────────────────────────────────────

async function getRoom(env: Env, code: string): Promise<RoomData | null> {
  const raw = await env.ROOMS.get(`room:${code.toUpperCase()}`);
  return raw ? (JSON.parse(raw) as RoomData) : null;
}

async function putRoom(env: Env, room: RoomData): Promise<void> {
  await env.ROOMS.put(`room:${room.code}`, JSON.stringify(room), {
    expirationTtl: ROOM_TTL,
  });
}

async function consumeSignals(env: Env, code: string, playerId: string): Promise<SignalEnvelope[]> {
  const key = `signals:${code}:${playerId}`;
  const raw = await env.ROOMS.get(key);
  if (!raw) return [];
  await env.ROOMS.delete(key);
  return JSON.parse(raw) as SignalEnvelope[];
}

async function appendSignal(env: Env, code: string, toId: string, signal: SignalEnvelope): Promise<void> {
  const key = `signals:${code}:${toId}`;
  const raw = await env.ROOMS.get(key);
  const queue: SignalEnvelope[] = raw ? JSON.parse(raw) : [];
  queue.push(signal);
  await env.ROOMS.put(key, JSON.stringify(queue), { expirationTtl: SIGNAL_TTL });
}

function verifyToken(player: PlayerRecord, token: string): boolean {
  return player.token === token;
}

// Strip token before sending player info to clients
function publicPlayer(p: PlayerRecord): Omit<PlayerRecord, 'token'> {
  const { token: _t, ...pub } = p;
  return pub;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ hostName?: string; password?: string }>();
  if (!body.hostName?.trim()) return err('hostName is required');

  // Collision-resistant code generation
  let code = generateRoomCode();
  for (let i = 0; i < 5; i++) {
    if (!(await getRoom(env, code))) break;
    code = generateRoomCode();
  }

  const hostId = generateId();
  const token  = generateId();

  const room: RoomData = {
    code,
    hostId,
    passwordHash: body.password ? await hashPassword(body.password) : null,
    players: [{
      id: hostId, token,
      name: body.hostName.trim(),
      ready: false, deckLocked: false,
      joinedAt: Date.now(),
    }],
    status: 'lobby',
    diceRolls: {},
    createdAt: Date.now(),
  };

  await putRoom(env, room);
  return json({ code, playerId: hostId, token });
}

async function handleGetRoom(code: string, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);
  return json({
    code:    room.code,
    status:  room.status,
    hostId:  room.hostId,
    players: room.players.map(publicPlayer),
  });
}

async function handleJoin(code: string, request: Request, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room)                          return err('Room not found', 404);
  if (room.status !== 'lobby')        return err('Game already started');
  if (room.players.length >= MAX_PLAYERS) return err('Room is full');

  const body = await request.json<{ playerName?: string; password?: string }>();
  if (!body.playerName?.trim()) return err('playerName is required');

  if (room.passwordHash) {
    if (!body.password) return err('Password required', 403);
    if (await hashPassword(body.password) !== room.passwordHash)
      return err('Incorrect password', 403);
  }

  const playerId = generateId();
  const token    = generateId();

  room.players.push({
    id: playerId, token,
    name: body.playerName.trim(),
    ready: false, deckLocked: false,
    joinedAt: Date.now(),
  });
  await putRoom(env, room);

  return json({
    code,
    playerId,
    token,
    hostId:  room.hostId,
    players: room.players.map(publicPlayer),
  });
}

async function handleReady(code: string, request: Request, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);

  const body = await request.json<{ playerId?: string; token?: string; deckLocked?: boolean }>();
  const player = room.players.find(p => p.id === body.playerId);
  if (!player || !body.token || !verifyToken(player, body.token)) return err('Unauthorized', 403);

  player.deckLocked = !!body.deckLocked;
  player.ready      = !!body.deckLocked;
  await putRoom(env, room);
  return json({ ok: true, players: room.players.map(publicPlayer) });
}

async function handleStart(code: string, request: Request, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);

  const body = await request.json<{ playerId?: string; token?: string }>();
  const player = room.players.find(p => p.id === body.playerId);
  if (!player || !body.token || !verifyToken(player, body.token)) return err('Unauthorized', 403);
  if (room.hostId !== body.playerId)   return err('Only the host can start the game');
  if (room.players.length < MIN_PLAYERS) return err(`Need at least ${MIN_PLAYERS} players`);
  if (!room.players.every(p => p.deckLocked)) return err('All players must lock in a deck first');

  room.status = 'started';
  room.diceRolls = {};
  await putRoom(env, room);
  return json({ ok: true });
}

async function handlePostSignal(code: string, request: Request, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);

  const body = await request.json<{
    fromId?: string; token?: string;
    toId?: string; type?: SignalType; payload?: unknown;
  }>();

  const fromPlayer = room.players.find(p => p.id === body.fromId);
  if (!fromPlayer || !body.token || !verifyToken(fromPlayer, body.token)) return err('Unauthorized', 403);

  const toPlayer = room.players.find(p => p.id === body.toId);
  if (!toPlayer) return err('Target player not found', 404);

  if (!body.type || !['offer', 'answer', 'ice-candidate'].includes(body.type))
    return err('Invalid signal type');

  await appendSignal(env, code, body.toId!, {
    id:      generateId(),
    fromId:  body.fromId!,
    type:    body.type,
    payload: body.payload,
    ts:      Date.now(),
  });

  return json({ ok: true });
}

async function handlePollSignals(code: string, url: URL, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);

  const playerId = url.searchParams.get('playerId');
  const token    = url.searchParams.get('token');
  if (!playerId || !token) return err('playerId and token are required');

  const player = room.players.find(p => p.id === playerId);
  if (!player || !verifyToken(player, token)) return err('Unauthorized', 403);

  const signals = await consumeSignals(env, code, playerId);
  return json({ signals });
}

async function handlePostDice(code: string, request: Request, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);

  const body = await request.json<{ playerId?: string; token?: string; value?: number }>();
  const player = room.players.find(p => p.id === body.playerId);
  if (!player || !body.token || !verifyToken(player, body.token)) return err('Unauthorized', 403);

  const value = Number(body.value);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    return err('value must be an integer between 1 and 20');
  }

  room.diceRolls[player.id] = value;
  await putRoom(env, room);
  return json({ ok: true, diceRolls: room.diceRolls });
}

async function handleGetDice(code: string, url: URL, env: Env): Promise<Response> {
  const room = await getRoom(env, code);
  if (!room) return err('Room not found', 404);

  const playerId = url.searchParams.get('playerId');
  const token    = url.searchParams.get('token');
  if (!playerId || !token) return err('playerId and token are required');

  const player = room.players.find(p => p.id === playerId);
  if (!player || !verifyToken(player, token)) return err('Unauthorized', 403);

  return json({ diceRolls: room.diceRolls ?? {} });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url      = new URL(request.url);
    const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    // segments: ['rooms'], ['rooms', CODE], ['rooms', CODE, 'join'], etc.

    try {
      const [seg0, code, action] = segments;

      if (seg0 !== 'rooms') return err('Not found', 404);

      // POST /rooms
      if (!code && request.method === 'POST') return handleCreateRoom(request, env);

      const upperCode = code?.toUpperCase();

      // GET /rooms/:code
      if (upperCode && !action && request.method === 'GET') return handleGetRoom(upperCode, env);

      // POST /rooms/:code/join
      if (upperCode && action === 'join' && request.method === 'POST')
        return handleJoin(upperCode, request, env);

      // POST /rooms/:code/ready
      if (upperCode && action === 'ready' && request.method === 'POST')
        return handleReady(upperCode, request, env);

      // POST /rooms/:code/start
      if (upperCode && action === 'start' && request.method === 'POST')
        return handleStart(upperCode, request, env);

      // POST /rooms/:code/signal
      if (upperCode && action === 'signal' && request.method === 'POST')
        return handlePostSignal(upperCode, request, env);

      // GET /rooms/:code/signals?playerId=...&token=...
      if (upperCode && action === 'signals' && request.method === 'GET')
        return handlePollSignals(upperCode, url, env);

      // POST /rooms/:code/dice
      if (upperCode && action === 'dice' && request.method === 'POST')
        return handlePostDice(upperCode, request, env);

      // GET /rooms/:code/dice?playerId=...&token=...
      if (upperCode && action === 'dice' && request.method === 'GET')
        return handleGetDice(upperCode, url, env);

      return err('Not found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return err('Internal server error', 500);
    }
  },
};
