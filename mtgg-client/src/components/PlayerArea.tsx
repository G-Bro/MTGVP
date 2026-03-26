import React, { useMemo, useRef, useState, useEffect } from 'react';
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const battlefieldRef = useRef<HTMLDivElement | null>(null);
  const dragFromRef = useRef<Zone | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

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

  function findCard(instanceId: string) {
    return lp.battlefield.find(c => c.instanceId === instanceId)
      ?? lp.commandZone.find(c => c.instanceId === instanceId)
      ?? lp.hand.find(c => c.instanceId === instanceId)
      ?? lp.library.find(c => c.instanceId === instanceId)
      ?? lp.graveyard.find(c => c.instanceId === instanceId)
      ?? lp.exile.find(c => c.instanceId === instanceId);
  }

  function getCurrentCardSize(): { w: number; h: number } {
    const root = getComputedStyle(document.documentElement);
    const w = parseFloat(root.getPropertyValue('--card-w')) || 95;
    const h = parseFloat(root.getPropertyValue('--card-h')) || 132;
    return { w, h };
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

  function pointerToBattlefieldPos(clientX: number, clientY: number, offset?: { x: number; y: number } | null): { x: number; y: number } | null {
    const zone = battlefieldRef.current;
    if (!zone) return null;
    const rect = zone.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    const xPx = clientX - rect.left - (offset?.x ?? 0);
    const yPx = clientY - rect.top - (offset?.y ?? 0);
    const xPct = (xPx / rect.width) * 100;
    const yPct = (yPx / rect.height) * 100;
    return { x: Math.max(0, Math.min(95, xPct)), y: Math.max(0, Math.min(95, yPct)) };
  }

  function handleCardSelect(cardId: string, e: React.MouseEvent) {
    setActiveCardId(cardId);
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedIds(prev => prev.includes(cardId)
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]);
      return;
    }
    setSelectedIds([cardId]);
  }

  function onCardMouseDown(e: React.MouseEvent, instanceId: string) {
    if (e.button !== 0) return;
    const from = findCardZone(instanceId);
    if (!from) return;

    // Keep relative cursor offset for battlefield/command cards to prevent jump-on-click.
    if (from === 'battlefield' || from === 'command') {
      const card = findCard(instanceId);
      const zone = battlefieldRef.current;
      if (card && zone) {
        const rect = zone.getBoundingClientRect();
        const { w, h } = getCurrentCardSize();
        const cardLeft = rect.left + (card.position.x / 100) * rect.width;
        const cardTop = rect.top + (card.position.y / 100) * rect.height;
        dragOffsetRef.current = {
          x: Math.max(0, Math.min(w, e.clientX - cardLeft)),
          y: Math.max(0, Math.min(h, e.clientY - cardTop)),
        };
      }
    } else {
      dragOffsetRef.current = null;
    }

    dragFromRef.current = from;
    setDraggingId(instanceId);
  }

  useEffect(() => {
    if (!draggingId) return;

    const handleMove = (e: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const from = dragFromRef.current;
        if (!from || (from !== 'battlefield' && from !== 'command')) return;
        const pos = pointerToBattlefieldPos(e.clientX, e.clientY, dragOffsetRef.current);
        if (!pos) return;
        dispatch({ type: 'POSITION_CARD', instanceId: draggingId, position: pos });
      });
    };

    const handleUp = (e: MouseEvent) => {
      const from = dragFromRef.current;
      const pos = pointerToBattlefieldPos(e.clientX, e.clientY, dragOffsetRef.current);

      if (pos) {
        if (from === 'battlefield' || from === 'command') {
          applyAndBroadcast(
            { type: 'POSITION_CARD', instanceId: draggingId, position: pos },
            { type: 'POSITION_CARD', instanceId: draggingId, position: pos },
            broadcast,
          );
        } else {
          moveCard(draggingId, 'battlefield', pos);
        }
      }

      dragFromRef.current = null;
      dragOffsetRef.current = null;
      setDraggingId(null);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [draggingId, dispatch, applyAndBroadcast, broadcast]);

  function toggleTapMany(ids: string[]) {
    const cards = ids
      .map(id => lp.battlefield.find(c => c.instanceId === id) ?? lp.commandZone.find(c => c.instanceId === id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    if (!cards.length) return;

    const nextTapped = !cards.every(c => c.tapped);
    for (const c of cards) {
      applyAndBroadcast(
        { type: 'TAP_CARD', instanceId: c.instanceId, tapped: nextTapped },
        { type: 'TAP_CARD', instanceId: c.instanceId, tapped: nextTapped },
        broadcast,
      );
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key.toLowerCase() !== 't') return;

      const ids = selectedIds.length ? selectedIds : (activeCardId ? [activeCardId] : []);
      if (!ids.length) return;

      e.preventDefault();
      toggleTapMany(ids);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, activeCardId, lp.battlefield, lp.commandZone]);

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
    const selectedForMenu = selectedIds.includes(id) ? selectedIds : [id];
    const bfCard = lp.battlefield.find(c => c.instanceId === id)
      ?? lp.commandZone.find(c => c.instanceId === id);

    return [
      {
        label: selectedForMenu.length > 1 ? 'Tap / Untap Selected (T)' : (bfCard?.tapped ? 'Untap' : 'Tap'),
        action: () => {
          if (!bfCard) return;
          toggleTapMany(selectedForMenu);
        },
      },
      { label: 'Add +1/+1 Counter', action: () => addCounter(id, '+1/+1', 1) },
      { label: 'Remove +1/+1 Counter', action: () => addCounter(id, '+1/+1', -1) },
      { divider: true, label: '', action: () => {} },
      { label: 'Move to Graveyard', action: () => moveCard(id, 'graveyard') },
      { label: 'Move to Exile', action: () => moveCard(id, 'exile') },
      { label: 'Move to Hand', action: () => moveCard(id, 'hand') },
      { label: 'Move to Command Zone', action: () => moveCard(id, 'command') },
    ];
  }, [menu, lp, selectedIds]);

  return (
    <div className="player-area">
      <div className="player-topline">
        <span className="player-name">{lp.name || 'You'}</span>
        <LifeCounter value={lp.life} label="Life" onChange={setLife} />
        <LifeCounter value={lp.poison} label="Poison" onChange={setPoison} min={0} />
      </div>

      <div
        ref={battlefieldRef}
        className={`battlefield-zone ${draggingId ? 'drop-active' : ''}`}
        onContextMenu={e => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'deck' } });
        }}
      >
        {lp.commandZone.map(card => (
          <div
            key={card.instanceId}
            className={`bf-card-wrap command-card ${selectedIds.includes(card.instanceId) ? 'selected' : ''}`}
            style={{ left: `${card.position.x}%`, top: `${card.position.y}%` }}
          >
            <PlayCard
              card={card}
              interactive
              onTap={(c, e) => handleCardSelect(c.instanceId, e)}
              onMouseDown={e => onCardMouseDown(e, card.instanceId)}
              onContextMenu={(e) => {
                if (!selectedIds.includes(card.instanceId)) {
                  setSelectedIds([card.instanceId]);
                  setActiveCardId(card.instanceId);
                }
                setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'battlefield-card', instanceId: card.instanceId } });
              }}
            />
          </div>
        ))}
        {lp.battlefield.map(card => (
          <div
            key={card.instanceId}
            className={`bf-card-wrap ${selectedIds.includes(card.instanceId) ? 'selected' : ''}`}
            style={{ left: `${card.position.x}%`, top: `${card.position.y}%` }}
          >
            <PlayCard
              card={card}
              interactive
              onTap={(c, e) => handleCardSelect(c.instanceId, e)}
              onMouseDown={e => onCardMouseDown(e, card.instanceId)}
              onContextMenu={(e) => {
                if (!selectedIds.includes(card.instanceId)) {
                  setSelectedIds([card.instanceId]);
                  setActiveCardId(card.instanceId);
                }
                setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'battlefield-card', instanceId: card.instanceId } });
              }}
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
