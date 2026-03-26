import React from 'react';
import ReactDOM from 'react-dom';
import type { ContextMenuState } from '../types';

interface MenuItem {
  label:    string;
  action:   () => void;
  danger?:  boolean;
  divider?: boolean;
}

interface Props {
  menu:    ContextMenuState;
  items:   MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ menu, items, onClose }: Props) {
  // Close on next click anywhere
  React.useEffect(() => {
    function close(e: MouseEvent) {
      // Don't close if the click is on the menu itself
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu')) onClose();
    }
    // Use capture phase so this fires before anything else
    document.addEventListener('mousedown', close, { capture: true });
    return () => document.removeEventListener('mousedown', close, { capture: true });
  }, [onClose]);

  // Adjust position to stay within viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 200;
  const menuH = items.length * 36;
  const x = Math.min(menu.x, vw - menuW - 8);
  const y = Math.min(menu.y, vh - menuH - 8);

  return ReactDOM.createPortal(
    <ul
      className="context-menu"
      style={{ left: x, top: y }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <li key={i} className="context-menu-divider" />
        ) : (
          <li
            key={i}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            onMouseDown={e => { e.stopPropagation(); item.action(); onClose(); }}
          >
            {item.label}
          </li>
        ),
      )}
    </ul>,
    document.body,
  );
}
