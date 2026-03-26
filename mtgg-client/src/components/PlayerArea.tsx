import React, { useMemo, useState } from 'react';
import type { ContextMenuState, PeerEvent, Zone } from '../types';
import { useGame } from '../context/GameContext';
import PlayCard from './PlayCard';
import LifeCounter from './LifeCounter';
import ContextMenu from './ContextMenu';

interface Props {
  broadcast: (event: PeerEvent) => void;
}

const ZONES: Zone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

export default function PlayerArea({ broadcast }: Props) {
  const { state, dispatch, applyAndBroadcast } = useGame();
  const lp = state.localPlayer;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menu, setMenu]             = useState<ContextMenuState | null>(null);

  function updateCounts() {
    broadcast({ type: 'UPDATE_COUNTS', handCount: lp.hand.length, libraryCount: lp.library.length });
  }

  function findCardZone(instanceId: string): Zone | null {
    for (const zone of ZONES) {
      const arr = zone === 'command' ? lp.commandZone : lp[zone as keyof typeof lp] as unknown;
      if (Array.isArray(arr) && arr.some((c: any) => c.instanceId === instanceId)) return zone;
    }
    return null;
  }

  function moveCard(instanceId: string, to: Zone, position?: { x: number; y: number }) {
    const from = findCardZone(instanceId);
    if (!from || from === to) return;

    const sourceZone = from === 'command' ? lp.commandZone : (lp as any)[from] as any[];
    const card = sourceZone.find(c => c.instanceId === instanceId);
    if (!card) return;

    dispatch({ type: 'MOVE_CARD', instanceId, from, to, position });

    const event: PeerEvent = {
      type: 'MOVE_CARD',
      instanceId,
      from,
      to,
      position,
      // cardData included when transitioning from hidden -> public zone
      cardData: (from === 'hand' || from === 'library') && (to === 'battlefield' || to === 'graveyard' || to === 'exile' || to === 'command')
        ? {
            scryfallId:   card.scryfallId,
            name:         card.name,
            imageUri:     card.imageUri,
            largeImageUri:card.largeImageUri,
            typeLine:     card.typeLine,
            manaCost:     card.manaCost,
            oracleText:   card.oracleText,
          }
        : undefined,
    };

    broadcast(event);

    if (from === 'hand' || from === 'library' || to === 'hand' || to === 'library') {
      setTimeout(updateCounts, 0);
    }
  }

  function drawCard() {
    if (!lp.library.length) return;
    dispatch({ type: 'DRAW_CARD' });
    setTimeout(updateCounts, 0);
  }

  function shuffleLibrary() {
    dispatch({ type: 'SHUFFLE_LIBRARY' });
    setTimeout(updateCounts, 0);
  }

  function setLife(life: number) {
    applyAndBroadcast(
      { type: 'SET_LIFE', life },
      { type: 'SET_LIFE', life },
      broadcast,
    );
  }

  function setPoison(poison: number) {
    applyAndBroadcast(
      { type: 'SET_POISON', poison },
      { type: 'SET_POISON', poison },
      broadcast,
    );
  }

  // ── Battlefield drag/drop ────────────────────────────────────────────────

  function battlefieldDrop(e: React.MouseEvent) {
    if (!draggingId) return;

    const zone = e.currentTarget as HTMLDivElement;
    const rect = zone.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    const pos  = { x: Math.max(0, Math.min(95, xPct)), y: Math.max(0, Math.min(95, yPct)) };

    const from = findCardZone(draggingId);
    if (from === 'battlefield') {
      applyAndBroadcast(
        { type: 'POSITION_CARD', instanceId: draggingId, position: pos },
        { type: 'POSITION_CARD', instanceId: draggingId, position: pos },
        broadcast,
      );
    } else {
      moveCard(draggingId, 'battlefield', pos);
    }

    setDraggingId(null);
  }

  function onCardMouseDown(e: React.MouseEvent, instanceId: string) {
    if (e.button !== 0) return;
    setDraggingId(instanceId);
  }

  function toggleTap(instanceId: string, currentlyTapped: boolean) {
    applyAndBroadcast(
      { type: 'TAP_CARD', instanceId, tapped: !currentlyTapped },
      { type: 'TAP_CARD', instanceId, tapped: !currentlyTapped },
      broadcast,
    );
  }

  function addCounter(instanceId: string, counterType: string, delta: number) {
    applyAndBroadcast(
      { type: 'ADD_COUNTER', instanceId, counterType, delta },
      { type: 'ADD_COUNTER', instanceId, counterType, delta },
      broadcast,
    );
  }

  const menuItems = useMemo(() => {
    if (!menu) return [];

    if (menu.target.kind === 'deck') {
      return [
        { label: 'Draw Card', action: drawCard },
        { label: 'Shuffle Library', action: shuffleLibrary },
      ];
    }
    if (menu.target.kind === 'graveyard') {
      return [
        {
          label: 'Return Top to Hand',
          action: () => {
            const top = lp.graveyard[lp.graveyard.length - 1];
            if (top) moveCard(top.instanceId, 'hand');
          },
        },
      ];
    }
    if (menu.target.kind === 'exile') {
      return [
        {
          label: 'Return Top to Hand',
          action: () => {
            const top = lp.exile[lp.exile.length - 1];
            if (top) moveCard(top.instanceId, 'hand');
          },
        },
      ];
    }

    const id = menu.target.instanceId;
    const bfCard = lp.battlefield.find(c => c.instanceId === id)
      ?? lp.commandZone.find(c => c.instanceId === id);

    return [
      {
        label: bfCard?.tapped ? 'Untap' : 'Tap',
        action: () => { if (bfCard) toggleTap(id, bfCard.tapped); },
      },
      { label: 'Add +1/+1 Counter', action: () => addCounter(id, '+1/+1', 1) },
      { label: 'Remove +1/+1 Counter', action: () => addCounter(id, '+1/+1', -1) },
      { divider: true, label: '', action: () => {} },
      { label: 'Move to Graveyard', action: () => moveCard(id, 'graveyard') },
      { label: 'Move to Exile', action: () => moveCard(id, 'exile') },
      { label: 'Move to Hand', action: () => moveCard(id, 'hand') },
      { label: 'Move to Command Zone', action: () => moveCard(id, 'command') },
    ];
  }, [menu, lp]);

  return (
    <div className="player-area">
      <div className="player-topline">
        <span className="player-name">{lp.name || 'You'}</span>
        <LifeCounter value={lp.life} label="Life" onChange={setLife} />
        <LifeCounter value={lp.poison} label="Poison" onChange={setPoison} min={0} />
      </div>

      <div
        className={`battlefield-zone ${draggingId ? 'drop-active' : ''}`}
        onMouseUp={battlefieldDrop}
        onContextMenu={e => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'deck' } });
        }}
      >
        {lp.commandZone.map(card => (
          <div
            key={card.instanceId}
            className="bf-card-wrap command-card"
            style={{ left: `${card.position.x}%`, top: `${card.position.y}%` }}
          >
            <PlayCard
              card={card}
              interactive
              onTap={() => toggleTap(card.instanceId, card.tapped)}
              onMouseDown={e => onCardMouseDown(e, card.instanceId)}
              onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'battlefield-card', instanceId: card.instanceId } })}
            />
          </div>
        ))}
        {lp.battlefield.map(card => (
          <div
            key={card.instanceId}
            className="bf-card-wrap"
            style={{ left: `${card.position.x}%`, top: `${card.position.y}%` }}
          >
            <PlayCard
              card={card}
              interactive
              onTap={() => toggleTap(card.instanceId, card.tapped)}
              onMouseDown={e => onCardMouseDown(e, card.instanceId)}
              onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'battlefield-card', instanceId: card.instanceId } })}
            />
          </div>
        ))}
      </div>

      <div className="player-lower">
        <div className="zone-mini" onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'deck' } }); }}>
          <strong>Library</strong>
          <span>{lp.library.length}</span>
          <button className="btn btn-xs" onClick={drawCard}>Draw</button>
        </div>
        <div className="zone-mini" onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'graveyard' } }); }}>
          <strong>Graveyard</strong>
          <span>{lp.graveyard.length}</span>
        </div>
        <div className="zone-mini" onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'exile' } }); }}>
          <strong>Exile</strong>
          <span>{lp.exile.length}</span>
        </div>
      </div>

      <div className="hand-zone">
        {lp.hand.map(card => (
          <div key={card.instanceId} className="hand-card">
            <PlayCard
              card={card}
              interactive
              onMouseDown={e => onCardMouseDown(e, card.instanceId)}
              onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'battlefield-card', instanceId: card.instanceId } })}
            />
          </div>
        ))}
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
