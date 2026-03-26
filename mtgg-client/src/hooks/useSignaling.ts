import { useEffect, useRef, useCallback } from 'react';
import type { SignalEnvelope, SignalType } from '../types';
import { WORKER_URL } from '../utils/helpers';

const POLL_INTERVAL_MS = 1500;

interface UseSignalingOptions {
  roomCode:  string;
  playerId:  string;
  token:     string;
  /** Called whenever new signals arrive. */
  onSignals: (signals: SignalEnvelope[]) => void;
  enabled:   boolean;
}

interface SendSignalPayload {
  toId:    string;
  type:    SignalType;
  payload: unknown;
}

export function useSignaling({ roomCode, playerId, token, onSignals, enabled }: UseSignalingOptions) {
  const onSignalsRef = useRef(onSignals);
  onSignalsRef.current = onSignals;

  // ── Poll for incoming signals ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !roomCode || !playerId || !token) return;

    let active = true;

    async function poll() {
      if (!active) return;
      try {
        const res = await fetch(
          `${WORKER_URL}/rooms/${roomCode}/signals?playerId=${playerId}&token=${token}`,
        );
        if (res.ok) {
          const data = await res.json() as { signals: SignalEnvelope[] };
          if (data.signals?.length) {
            onSignalsRef.current(data.signals);
          }
        }
      } catch {
        // Network error – ignore and keep polling
      }
      if (active) setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => { active = false; };
  }, [enabled, roomCode, playerId, token]);

  // ── Send a signal to another player ───────────────────────────────────────
  const sendSignal = useCallback(
    async ({ toId, type, payload }: SendSignalPayload): Promise<void> => {
      await fetch(`${WORKER_URL}/rooms/${roomCode}/signal`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fromId: playerId, token, toId, type, payload }),
      });
    },
    [roomCode, playerId, token],
  );

  return { sendSignal };
}
