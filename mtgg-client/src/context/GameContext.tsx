import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import type {
  GameSession, LocalPlayerState, OpponentState,
  GameCard, Zone, PeerEvent,
} from '../types';
import { shuffle } from '../utils/helpers';

// ─── Initial state ────────────────────────────────────────────────────────────

function makeOpponent(playerId: string, name: string): OpponentState {
  return {
    playerId, name,
    life: 40, poison: 0,
    handCount: 0, libraryCount: 0,
    battlefield: [], graveyard: [], exile: [], commandZone: [],
  };
}

function makeLocalPlayer(playerId: string, name: string): LocalPlayerState {
  return {
    playerId, name,
    life: 40, poison: 0,
    library: [], hand: [],
    battlefield: [], graveyard: [], exile: [], commandZone: [],
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

type GameAction =
  | { type: 'INIT_GAME'; localPlayerId: string; localName: string; opponents: { id: string; name: string }[] }
  | { type: 'LOAD_DECK'; library: GameCard[]; commandZone: GameCard[] }
  | { type: 'SET_PHASE'; phase: GameSession['phase'] }
  | { type: 'SET_TURN_ORDER'; order: string[] }
  | { type: 'RECORD_DICE_ROLL'; playerId: string; value: number }
  // Local player card actions
  | { type: 'TAP_CARD'; instanceId: string; tapped: boolean }
  | { type: 'POSITION_CARD'; instanceId: string; position: { x: number; y: number } }
  | { type: 'MOVE_CARD'; instanceId: string; from: Zone; to: Zone; position?: { x: number; y: number } }
  | { type: 'DRAW_CARD' }
  | { type: 'DRAW_OPENING_HAND'; count?: number }
  | { type: 'SHUFFLE_LIBRARY' }
  | { type: 'SET_LIFE'; life: number }
  | { type: 'SET_POISON'; poison: number }
  | { type: 'ADD_COUNTER'; instanceId: string; counterType: string; delta: number }
  // Opponent updates (from peer events)
  | { type: 'OPPONENT_STATE_SYNC'; playerId: string; state: Omit<OpponentState, 'playerId'> }
  | { type: 'OPPONENT_TAP_CARD'; playerId: string; instanceId: string; tapped: boolean }
  | { type: 'OPPONENT_POSITION_CARD'; playerId: string; instanceId: string; position: { x: number; y: number } }
  | { type: 'OPPONENT_MOVE_CARD'; playerId: string; instanceId: string; from: Zone; to: Zone; cardData?: Partial<GameCard>; position?: { x: number; y: number } }
  | { type: 'OPPONENT_SET_LIFE'; playerId: string; life: number }
  | { type: 'OPPONENT_SET_POISON'; playerId: string; poison: number }
  | { type: 'OPPONENT_UPDATE_COUNTS'; playerId: string; handCount: number; libraryCount: number }
  | { type: 'OPPONENT_ADD_COUNTER'; playerId: string; instanceId: string; counterType: string; delta: number }
  | { type: 'OPPONENT_DICE_ROLL'; playerId: string; value: number };

function getZoneArray(player: LocalPlayerState, zone: Zone): GameCard[] {
  switch (zone) {
    case 'library':    return player.library;
    case 'hand':       return player.hand;
    case 'battlefield':return player.battlefield;
    case 'graveyard':  return player.graveyard;
    case 'exile':      return player.exile;
    case 'command':    return player.commandZone;
  }
}

function setZoneArray(player: LocalPlayerState, zone: Zone, cards: GameCard[]): LocalPlayerState {
  switch (zone) {
    case 'library':    return { ...player, library:     cards };
    case 'hand':       return { ...player, hand:        cards };
    case 'battlefield':return { ...player, battlefield: cards };
    case 'graveyard':  return { ...player, graveyard:   cards };
    case 'exile':      return { ...player, exile:       cards };
    case 'command':    return { ...player, commandZone: cards };
  }
}

function getOppZone(opp: OpponentState, zone: Zone): GameCard[] {
  switch (zone) {
    case 'battlefield': return opp.battlefield;
    case 'graveyard':   return opp.graveyard;
    case 'exile':       return opp.exile;
    case 'command':     return opp.commandZone;
    default:            return [];
  }
}

function setOppZone(opp: OpponentState, zone: Zone, cards: GameCard[]): OpponentState {
  switch (zone) {
    case 'battlefield': return { ...opp, battlefield: cards };
    case 'graveyard':   return { ...opp, graveyard:   cards };
    case 'exile':       return { ...opp, exile:       cards };
    case 'command':     return { ...opp, commandZone: cards };
    default:            return opp;
  }
}

function gameReducer(state: GameSession, action: GameAction): GameSession {
  switch (action.type) {

    case 'INIT_GAME': {
      const freshLocal = makeLocalPlayer(action.localPlayerId, action.localName);
      return {
        ...state,
        diceRolls: {},
        turnOrder: [],
        localPlayer: {
          ...freshLocal,
          // Preserve pre-game deck import from lobby phase.
          library:     state.localPlayer.library,
          commandZone: state.localPlayer.commandZone,
        },
        opponents:   action.opponents.map(o => makeOpponent(o.id, o.name)),
      };
    }

    case 'LOAD_DECK': {
      return {
        ...state,
        localPlayer: {
          ...state.localPlayer,
          library:     action.library,
          commandZone: action.commandZone,
        },
      };
    }

    case 'SET_PHASE': return { ...state, phase: action.phase };

    case 'SET_TURN_ORDER': return { ...state, turnOrder: action.order };

    case 'RECORD_DICE_ROLL': {
      const rolls = { ...state.diceRolls, [action.playerId]: action.value };
      return { ...state, diceRolls: rolls };
    }

    // ── Local player actions ────────────────────────────────────────────────

    case 'DRAW_CARD': {
      const lib = [...state.localPlayer.library];
      if (!lib.length) return state;
      const [drawn, ...remaining] = lib;
      return {
        ...state,
        localPlayer: {
          ...state.localPlayer,
          library: remaining,
          hand:    [...state.localPlayer.hand, drawn],
        },
      };
    }

    case 'DRAW_OPENING_HAND': {
      const count = Math.max(0, action.count ?? 7);
      const lib = [...state.localPlayer.library];
      if (!lib.length || count === 0) return state;
      const drawn = lib.slice(0, count);
      const remaining = lib.slice(count);
      return {
        ...state,
        localPlayer: {
          ...state.localPlayer,
          library: remaining,
          hand: [...state.localPlayer.hand, ...drawn],
        },
      };
    }

    case 'SHUFFLE_LIBRARY': {
      return {
        ...state,
        localPlayer: {
          ...state.localPlayer,
          library: shuffle([...state.localPlayer.library]),
        },
      };
    }

    case 'TAP_CARD': {
      const update = (cards: GameCard[]) =>
        cards.map(c => c.instanceId === action.instanceId ? { ...c, tapped: action.tapped } : c);
      const lp = state.localPlayer;
      return {
        ...state,
        localPlayer: {
          ...lp,
          battlefield: update(lp.battlefield),
          commandZone: update(lp.commandZone),
        },
      };
    }

    case 'POSITION_CARD': {
      const update = (cards: GameCard[]) =>
        cards.map(c => c.instanceId === action.instanceId ? { ...c, position: action.position } : c);
      const lp = state.localPlayer;
      return {
        ...state,
        localPlayer: {
          ...lp,
          battlefield: update(lp.battlefield),
          commandZone: update(lp.commandZone),
        },
      };
    }

    case 'MOVE_CARD': {
      const lp    = state.localPlayer;
      const fromZ = getZoneArray(lp, action.from);
      const card  = fromZ.find(c => c.instanceId === action.instanceId);
      if (!card) return state;
      const newFrom = fromZ.filter(c => c.instanceId !== action.instanceId);
      const newCard: GameCard = {
        ...card,
        tapped:   false,
        position: action.position ?? { x: 5 + Math.random() * 60, y: 5 + Math.random() * 60 },
      };
      const toZ    = getZoneArray(lp, action.to);
      const newTo  = [...toZ, newCard];
      let updated  = setZoneArray(lp, action.from, newFrom);
      updated      = setZoneArray(updated, action.to, newTo);
      return { ...state, localPlayer: updated };
    }

    case 'SET_LIFE': {
      return { ...state, localPlayer: { ...state.localPlayer, life: action.life } };
    }

    case 'SET_POISON': {
      return { ...state, localPlayer: { ...state.localPlayer, poison: action.poison } };
    }

    case 'ADD_COUNTER': {
      const update = (cards: GameCard[]) =>
        cards.map(c => {
          if (c.instanceId !== action.instanceId) return c;
          const current = c.counters[action.counterType] ?? 0;
          return { ...c, counters: { ...c.counters, [action.counterType]: current + action.delta } };
        });
      const lp = state.localPlayer;
      return {
        ...state,
        localPlayer: {
          ...lp,
          battlefield: update(lp.battlefield),
          commandZone: update(lp.commandZone),
        },
      };
    }

    // ── Opponent updates ────────────────────────────────────────────────────

    case 'OPPONENT_STATE_SYNC': {
      return {
        ...state,
        opponents: state.opponents.map(o =>
          o.playerId === action.playerId ? { ...o, ...action.state } : o,
        ),
      };
    }

    case 'OPPONENT_TAP_CARD': {
      return {
        ...state,
        opponents: state.opponents.map(o => {
          if (o.playerId !== action.playerId) return o;
          return {
            ...o,
            battlefield: o.battlefield.map(c =>
              c.instanceId === action.instanceId ? { ...c, tapped: action.tapped } : c,
            ),
          };
        }),
      };
    }

    case 'OPPONENT_POSITION_CARD': {
      return {
        ...state,
        opponents: state.opponents.map(o => {
          if (o.playerId !== action.playerId) return o;
          return {
            ...o,
            battlefield: o.battlefield.map(c =>
              c.instanceId === action.instanceId ? { ...c, position: action.position } : c,
            ),
            commandZone: o.commandZone.map(c =>
              c.instanceId === action.instanceId ? { ...c, position: action.position } : c,
            ),
          };
        }),
      };
    }

    case 'OPPONENT_MOVE_CARD': {
      return {
        ...state,
        opponents: state.opponents.map(o => {
          if (o.playerId !== action.playerId) return o;
          const fromZone = getOppZone(o, action.from);
          let card = fromZone.find(c => c.instanceId === action.instanceId);

          // Card might be moving from hand/library (not tracked as objects) into a public zone
          if (!card && action.cardData) {
            card = {
              instanceId:   action.instanceId,
              tapped:       false,
              counters:     {},
              position:     action.position ?? { x: 10, y: 10 },
              faceDown:     false,
              scryfallId:   action.cardData.scryfallId   ?? '',
              name:         action.cardData.name         ?? 'Unknown',
              imageUri:     action.cardData.imageUri     ?? '',
              largeImageUri:action.cardData.largeImageUri ?? '',
              typeLine:     action.cardData.typeLine     ?? '',
              manaCost:     action.cardData.manaCost     ?? '',
              oracleText:   action.cardData.oracleText   ?? '',
            };
          }
          if (!card) return o;

          const newFrom = fromZone.filter(c => c.instanceId !== action.instanceId);
          const toZone  = getOppZone(o, action.to);
          const newCard: GameCard = { ...card, tapped: false, position: action.position ?? card.position };

          let updated = setOppZone(o, action.from, newFrom);
          updated     = setOppZone(updated, action.to, [...toZone, newCard]);
          return updated;
        }),
      };
    }

    case 'OPPONENT_SET_LIFE': {
      return {
        ...state,
        opponents: state.opponents.map(o =>
          o.playerId === action.playerId ? { ...o, life: action.life } : o,
        ),
      };
    }

    case 'OPPONENT_SET_POISON': {
      return {
        ...state,
        opponents: state.opponents.map(o =>
          o.playerId === action.playerId ? { ...o, poison: action.poison } : o,
        ),
      };
    }

    case 'OPPONENT_UPDATE_COUNTS': {
      return {
        ...state,
        opponents: state.opponents.map(o =>
          o.playerId === action.playerId
            ? { ...o, handCount: action.handCount, libraryCount: action.libraryCount }
            : o,
        ),
      };
    }

    case 'OPPONENT_ADD_COUNTER': {
      return {
        ...state,
        opponents: state.opponents.map(o => {
          if (o.playerId !== action.playerId) return o;
          return {
            ...o,
            battlefield: o.battlefield.map(c => {
              if (c.instanceId !== action.instanceId) return c;
              const current = c.counters[action.counterType] ?? 0;
              return { ...c, counters: { ...c.counters, [action.counterType]: current + action.delta } };
            }),
          };
        }),
      };
    }

    case 'OPPONENT_DICE_ROLL': {
      return { ...state, diceRolls: { ...state.diceRolls, [action.playerId]: action.value } };
    }

    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const initialSession: GameSession = {
  phase:            'lobby',
  turnOrder:        [],
  currentTurnIndex: 0,
  diceRolls:        {},
  localPlayer:      makeLocalPlayer('', ''),
  opponents:        [],
};

interface GameContextValue {
  state:    GameSession;
  dispatch: React.Dispatch<GameAction>;
  /** Dispatch + broadcast to peers in one call. */
  applyAndBroadcast: (action: GameAction, peerEvent: PeerEvent, broadcastFn: (e: PeerEvent) => void) => void;
  /** Apply an incoming peer event to state. */
  applyPeerEvent: (fromPlayerId: string, event: PeerEvent) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialSession);
  const broadcastRef = useRef<((e: PeerEvent) => void) | null>(null);

  const applyAndBroadcast = useCallback(
    (action: GameAction, peerEvent: PeerEvent, broadcastFn: (e: PeerEvent) => void) => {
      dispatch(action);
      broadcastRef.current = broadcastFn;
      broadcastFn(peerEvent);
    },
    [],
  );

  const applyPeerEvent = useCallback((fromPlayerId: string, event: PeerEvent) => {
    switch (event.type) {
      case 'STATE_SYNC':
        dispatch({ type: 'OPPONENT_STATE_SYNC', playerId: fromPlayerId, state: event.state });
        break;
      case 'TAP_CARD':
        dispatch({ type: 'OPPONENT_TAP_CARD', playerId: fromPlayerId, instanceId: event.instanceId, tapped: event.tapped });
        break;
      case 'POSITION_CARD':
        dispatch({ type: 'OPPONENT_POSITION_CARD', playerId: fromPlayerId, instanceId: event.instanceId, position: event.position });
        break;
      case 'MOVE_CARD':
        dispatch({ type: 'OPPONENT_MOVE_CARD', playerId: fromPlayerId, instanceId: event.instanceId, from: event.from, to: event.to, cardData: event.cardData, position: event.position });
        break;
      case 'SET_LIFE':
        dispatch({ type: 'OPPONENT_SET_LIFE', playerId: fromPlayerId, life: event.life });
        break;
      case 'SET_POISON':
        dispatch({ type: 'OPPONENT_SET_POISON', playerId: fromPlayerId, poison: event.poison });
        break;
      case 'UPDATE_COUNTS':
        dispatch({ type: 'OPPONENT_UPDATE_COUNTS', playerId: fromPlayerId, handCount: event.handCount, libraryCount: event.libraryCount });
        break;
      case 'ADD_COUNTER':
        dispatch({ type: 'OPPONENT_ADD_COUNTER', playerId: fromPlayerId, instanceId: event.instanceId, counterType: event.counterType, delta: event.delta });
        break;
      case 'DICE_ROLL':
        dispatch({ type: 'OPPONENT_DICE_ROLL', playerId: fromPlayerId, value: event.value });
        break;
    }
  }, []);

  return (
    <GameContext.Provider value={{ state, dispatch, applyAndBroadcast, applyPeerEvent }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
