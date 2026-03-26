import React, { useState } from 'react';

interface Props {
  value: number;
  label?: string;
  onChange: (newValue: number) => void;
  min?: number;
}

export default function LifeCounter({ value, label, onChange, min = -999 }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
  }

  function commitEdit() {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n >= min) onChange(n);
    setEditing(false);
  }

  return (
    <div className="life-counter">
      {label && <span className="life-label">{label}</span>}
      <button className="life-btn" onClick={() => onChange(value + 1)}>+</button>
      {editing ? (
        <input
          className="life-input"
          type="number"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <span className="life-value" onClick={startEdit} title="Click to edit">{value}</span>
      )}
      <button className="life-btn" onClick={() => onChange(value - 1)}>−</button>
    </div>
  );
}
