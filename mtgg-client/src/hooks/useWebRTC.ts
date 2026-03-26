import { useRef, useCallback, useEffect } from 'react';
import type { SignalEnvelope, PeerEvent } from '../types';

/**
 * Free STUN servers (no TURN in MVP – see spec §6.2 for upgrade path to
 * Cloudflare Workers + Durable Objects if NAT issues arise in practice).
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type SendSignalFn = (args: { toId: string; type: 'offer' | 'answer' | 'ice-candidate'; payload: unknown }) => Promise<void>;

interface UseWebRTCOptions {
  localPlayerId: string;
  /** Called for each game event received from any peer. */
  onPeerEvent: (fromPlayerId: string, event: PeerEvent) => void;
  sendSignal: SendSignalFn;
}

export function useWebRTC({ localPlayerId, onPeerEvent, sendSignal }: UseWebRTCOptions) {
  // Map of peerId → RTCPeerConnection
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Map of peerId → RTCDataChannel (reliable, ordered)
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());

  const onPeerEventRef = useRef(onPeerEvent);
  onPeerEventRef.current = onPeerEvent;

  // ── Create or return an existing peer connection ───────────────────────────
  const getOrCreatePeer = useCallback(
    (peerId: string): RTCPeerConnection => {
      if (peerConnections.current.has(peerId)) {
        return peerConnections.current.get(peerId)!;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // Forward ICE candidates to the peer via signaling
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          sendSignal({ toId: peerId, type: 'ice-candidate', payload: candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          peerConnections.current.delete(peerId);
          dataChannels.current.delete(peerId);
        }
      };

      // Incoming data channel (from the offerer's side)
      pc.ondatachannel = ({ channel }) => {
        setupDataChannel(peerId, channel);
      };

      peerConnections.current.set(peerId, pc);
      return pc;
    },
    [sendSignal],
  );

  const setupDataChannel = useCallback((peerId: string, channel: RTCDataChannel) => {
    channel.onopen = () => {
      dataChannels.current.set(peerId, channel);
    };
    channel.onclose = () => {
      dataChannels.current.delete(peerId);
    };
    channel.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data as string) as PeerEvent;
        onPeerEventRef.current(peerId, event);
      } catch {
        // Malformed message – ignore
      }
    };
  }, []);

  // ── Initiate connection to a new peer (caller / offerer side) ─────────────
  const connectToPeer = useCallback(
    async (peerId: string) => {
      const pc      = getOrCreatePeer(peerId);
      const channel = pc.createDataChannel('game', { ordered: true });
      setupDataChannel(peerId, channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal({ toId: peerId, type: 'offer', payload: offer });
    },
    [getOrCreatePeer, setupDataChannel, sendSignal],
  );

  // ── Handle incoming signals from the Worker ────────────────────────────────
  const handleSignals = useCallback(
    async (signals: SignalEnvelope[]) => {
      for (const sig of signals) {
        const fromId = sig.fromId;

        if (sig.type === 'offer') {
          const pc = getOrCreatePeer(fromId);
          await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal({ toId: fromId, type: 'answer', payload: answer });

        } else if (sig.type === 'answer') {
          const pc = peerConnections.current.get(fromId);
          if (pc && pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
          }

        } else if (sig.type === 'ice-candidate') {
          const pc = peerConnections.current.get(fromId);
          if (pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(sig.payload as RTCIceCandidateInit));
            } catch {
              // Stale candidate – ignore
            }
          }
        }
      }
    },
    [getOrCreatePeer, sendSignal],
  );

  // ── Broadcast a game event to all connected peers ─────────────────────────
  const broadcast = useCallback((event: PeerEvent) => {
    const msg = JSON.stringify(event);
    dataChannels.current.forEach(ch => {
      if (ch.readyState === 'open') ch.send(msg);
    });
  }, []);

  // ── Send a game event to a specific peer ──────────────────────────────────
  const sendToPeer = useCallback((peerId: string, event: PeerEvent) => {
    const ch = dataChannels.current.get(peerId);
    if (ch?.readyState === 'open') {
      ch.send(JSON.stringify(event));
    }
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
      dataChannels.current.clear();
    };
  }, []);

  return { connectToPeer, handleSignals, broadcast, sendToPeer, localPlayerId };
}
