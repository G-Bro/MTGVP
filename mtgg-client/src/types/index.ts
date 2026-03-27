// ─── Card data (from Scryfall) ────────────────────────────────────────────────

export interface ScryfallCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc: number;
  colors?: string[];
  color_identity: string[];
  image_uris?: { normal: string; large: string; small: string };
  card_faces?: { image_uris?: { normal: string; large: string; small: string }; name: string }[];
  layout: string;
}

// A card instance on the table (one per physical card in the game session)
export interface GameCard {
  instanceId: string;       // UUID unique to this game instance
  scryfallId: string;
  name: string;
  imageUri: string;         // front-face normal image
  largeImageUri: string;    // for inspect hover
  typeLine: string;
  manaCost: string;
  oracleText: string;
  tapped: boolean;
  counters: Record<string, number>;  // e.g. { '+1/+1': 3, loyalty: 5 }
  position: { x: number; y: number }; // battlefield position (% of zone dimensions)
  faceDown: boolean;
}

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';

// ─── Deck import ──────────────────────────────────────────────────────────────

export interface DeckEntry {
  quantity: number;
  name: string;
  isCommander: boolean;
}

export interface ParsedDeck {
  commander: DeckEntry[];
  main: DeckEntry[];
  errors: string[];
  mtgoCommanderCandidate?: string;
}

// ─── Room / lobby ─────────────────────────────────────────────────────────────

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  deckLocked: boolean;
  joinedAt: number;
}

export interface RoomInfo {
  code: string;
  status: 'lobby' | 'started' | 'ended';
  hostId: string;
  topDeckEnabled: boolean;
  players: LobbyPlayer[];
}

// ─── Local session identity ───────────────────────────────────────────────────

export interface LocalSession {
  roomCode: string;
  playerId: string;
  token: string;
  playerName: string;
  isHost: boolean;
}

// ─── Game state ───────────────────────────────────────────────────────────────

export interface LocalPlayerState {
  playerId: string;
  name: string;
  life: number;
  poison: number;
  library: GameCard[];     // private — never broadcast
  hand: GameCard[];        // private — never broadcast
  battlefield: GameCard[];
  graveyard: GameCard[];
  exile: GameCard[];
  commandZone: GameCard[];
}

// Opponent state – derived entirely from received peer events (no hand/library card data)
export interface OpponentState {
  playerId: string;
  name: string;
  life: number;
  poison: number;
  handCount: number;
  libraryCount: number;
  battlefield: GameCard[];
  graveyard: GameCard[];
  exile: GameCard[];
  commandZone: GameCard[];
}

export interface GameSession {
  phase: 'lobby' | 'dice' | 'game';
  turnOrder: string[];        // playerIds in order
  currentTurnIndex: number;
  diceRolls: Record<string, number>; // playerId → roll value
  localPlayer: LocalPlayerState;
  opponents: OpponentState[];
}

// ─── WebRTC / peer events ─────────────────────────────────────────────────────

export type PeerEvent =
  // Sent once on WebRTC connection to sync public state
  | { type: 'STATE_SYNC'; state: Omit<OpponentState, 'playerId'> }
  // Card actions
  | { type: 'TAP_CARD'; instanceId: string; tapped: boolean }
  | { type: 'POSITION_CARD'; instanceId: string; position: { x: number; y: number } }
  // from/to are Zone values; cardData included when moving INTO a public zone for the first time
  | { type: 'MOVE_CARD'; instanceId: string; from: Zone; to: Zone; cardData?: Omit<GameCard, 'instanceId' | 'tapped' | 'counters' | 'position' | 'faceDown'>; position?: { x: number; y: number } }
  // Life / counters
  | { type: 'SET_LIFE'; life: number }
  | { type: 'SET_POISON'; poison: number }
  | { type: 'UPDATE_COUNTS'; handCount: number; libraryCount: number }
  | { type: 'ADD_COUNTER'; instanceId: string; counterType: string; delta: number }
  // Dice roll during setup phase
  | { type: 'DICE_ROLL'; value: number };

// ─── Signalling (Worker exchange) ─────────────────────────────────────────────

export type SignalType = 'offer' | 'answer' | 'ice-candidate';

export interface SignalEnvelope {
  id: string;
  fromId: string;
  type: SignalType;
  payload: unknown;
  ts: number;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

export interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTarget;
}

export type ContextMenuTarget =
  | { kind: 'deck' }
  | { kind: 'graveyard' }
  | { kind: 'exile' }
  | { kind: 'battlefield-card'; instanceId: string };
