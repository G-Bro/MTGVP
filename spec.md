# MTGVP Product and Technical Specification

## 1. Project Summary

Build a no-install web application that lets friends play multiplayer Commander-format Magic: The Gathering as a digital tabletop.

The app provides shared game spaces and synchronization, but does not automate Magic rules.

## 2. Goals

1. Allow 2-4 players to start and play a Commander game in browser.
2. Require no local installs or native downloads.
3. Support deck loading from Moxfield export formats and similar decklist formats.
4. Provide synchronized play areas where players manually move cards and manage life.
5. Keep interactions lightweight enough for free hosting tiers.

## 3. Non-Goals (MVP)

1. No rules engine (no automatic priority, stack resolution, legality checks, or triggers).
2. No ranked matchmaking or public ladder.
3. No monetization or storefront.
4. No enterprise anti-cheat guarantees.

## 4. Core User Stories

1. As a host, I can create a game room with optional password protection.
2. As a player, I can join a host room and wait in lobby.
3. As host, I can start game once 2-4 players are present and ready.
4. As a player, I can import my deck before game starts.
5. As a player, I can roll for turn order and begin play.
6. As a player, I can manually arrange, tap, untap, and move cards across zones.
7. As a player, I can see opponents' board actions synchronized in near real-time.
8. As a player, I can hover cards to inspect full details.

## 5. Functional Requirements

### 5.1 Home Screen

The home screen must show exactly two primary actions:

1. Host Game
2. Join Game

### 5.2 Host Flow

1. Host creates a room.
2. Host can set optional room password.
3. App generates shareable join information.
4. Host can see connected players and readiness status.
5. Host can start game only when:
	- Player count is between 2 and 4 inclusive.
	- All players have locked in deck.

> Comment (Feasibility): Browsers do not provide a reliable, user-friendly model for players manually hosting by sharing their personal IP address.
> Alternative: Use a generated room code and optional password as the primary join mechanism. Optionally present a shareable URL containing room code.
> Decision: Implement room code + optional password with server-managed room lifecycle via Cloudflare Workers signaling endpoints.

### 5.3 Join Flow

1. Player enters room code (or shareable link).
2. Player enters password if required.
3. Player joins lobby and sees player list.
4. Player loads a deck and marks Ready.

### 5.4 Pre-Game and Turn Order

1. Once host starts game, each player performs a digital dice roll.
2. App computes and displays turn order from roll results.
3. Game begins with shared board state initialized.

### 5.5 Deck Import

MVP must support:

1. Moxfield-style text export parsing.
2. At least one generic plain-text decklist format used by common deck builders.

Should support:

1. Parsing card quantities and names.
2. Marking commander card(s).
3. Validation that deck contains parseable card entries.

Out of scope for MVP:

1. Full Commander legality enforcement.

### 5.6 Gameplay Area and Zones

#### Local player layout

1. Local player play area occupies bottom half of screen.
2. Right side panel contains:
	- Deck (library)
	- Graveyard (under deck)
	- Exile (under graveyard)

#### Opponent layout

1. Opponent area occupies top half of screen.
2. Split rules:
	- 2-player game: top half is single opponent area.
	- 3-player game: top half split into two equal opponent areas.
	- 4-player game: top half split into three equal opponent areas.

#### Zone interactions

1. Players can drag and place cards in battlefield.
2. Players can tap and untap cards at will.
3. Players can move cards between visible zones manually.
4. Players can adjust life totals with explicit controls.

### 5.7 Right-Click Menus

Right-click context actions must exist for:

1. Deck
2. Graveyard
3. Exile

Required menu actions include:

1. Scry
2. Search
3. Explore
4. Additional deck-viewing operations (for example: reveal top N, shuffle, view pile)

> Comment (Feasibility): "Search" and "deck viewing" involve hidden information and can leak private data if state is naively broadcast.
> Alternative: In MVP, trust-based private panels are acceptable for friend groups. Post-MVP can encrypt hidden-zone payloads or use server-authoritative hidden data handling.
> Decision: Deck/hand operations are client-side only. Other players receive only deck count and hand count updates. Card identity is broadcast only when a card enters a public zone (battlefield, graveyard, exile, or other explicitly revealed state).

### 5.8 Card Inspection

1. Hovering a card must show inspect preview (large image and key card info).
2. Inspect behavior must work for local and opponent cards visible on board.

### 5.9 Hidden Information Visibility Rules

1. Deck contents are private to owning player unless cards are explicitly revealed.
2. Hand contents are private to owning player unless cards are explicitly revealed.
3. Opponents may only see:
	- Deck card count
	- Hand card count
4. Card identity/details must synchronize to all players only when the card moves to a public zone:
	- Battlefield
	- Graveyard
	- Exile
	- Any explicit reveal effect chosen by user action
5. Deck actions such as search, scry, and explore are executed locally for the owning player and must not broadcast hidden card identities.

### 5.10 Synchronization

1. Player actions must propagate to all connected players.
2. Board updates should appear near real-time (target under 300 ms median on stable networks).
3. Reconnect flow should restore most recent known room state.

## 6. Technical Architecture

### 6.1 Recommended MVP Architecture (Hybrid)

1. Static frontend hosted on GitHub Pages (or Cloudflare Pages / Netlify free tier).
2. Lightweight signaling backend on Cloudflare Workers (selected platform).
3. Peer data transfer via WebRTC DataChannels.
4. Optional lightweight room-state persistence for reconnect safety.

> Comment (Feasibility): GitHub Pages is static hosting only and cannot run persistent signaling endpoints.
> Alternative: If Cloudflare Workers free-tier limits are reached, migrate signaling/persistence to Supabase Realtime or Firebase Realtime Database.
> Decision: MVP uses GitHub Pages for frontend and Cloudflare Workers for room management and signaling.

### 6.2 Networking Model

1. Room creation and join handshake occurs through signaling service.
2. WebRTC peer mesh is established for 2-4 players.
3. STUN servers are required for NAT traversal.
4. TURN fallback should be included for users behind restrictive NAT/firewall.

> Comment (Feasibility): Pure peer-to-peer without TURN fallback is unreliable for a portion of users.
> Alternative: Implement automatic fallback to relayed path (TURN or temporary server relay mode) when direct P2P fails.
> Upgrade path: If NAT failures prove persistent in practice, migrate gameplay transport to Cloudflare Workers + Durable Objects WebSocket relay. This eliminates P2P and TURN entirely — all clients hold a persistent WebSocket to a Durable Object acting as the room hub. Request count stays low (~100 per game) because WebSocket messages are not counted as individual Worker invocations. Cost is $5/month for the Workers Paid plan which unlocks Durable Objects. This is the recommended escalation if the free STUN-only baseline causes connection failures for any player.

### 6.3 Data Model (MVP-level)

Game session state should include:

1. Room metadata (room id, password policy, host id).
2. Player list (2-4 players, ready state, deck locked state).
3. Turn order and active player marker.
4. Per-player zones (library count, hand private state, battlefield cards, graveyard, exile).
5. Life totals and optional counters.

Hidden-zone serialization requirements:

1. Library and hand card identities must not be serialized into shared multiplayer payloads.
2. Shared payloads include only `libraryCount` and `handCount` for non-owning players.
3. Public-zone payloads include full card identity and state (zone position, tapped state, counters).

### 6.4 Event Protocol (MVP)

Actions should be modeled as ordered events with idempotency keys.

Required event types:

1. Move card
2. Tap card
3. Untap card
4. Modify life total
5. Zone action (scry/search/explore/reveal/shuffle)
6. Dice roll
7. Ready lock / unlock

Hidden-information event rules:

1. Draw to hand events broadcast count deltas only (no card identity).
2. Private deck/hand reordering events (search/scry/explore) broadcast count/state deltas only when needed.
3. Any event moving a card into a public zone must include card identity so all players can inspect that card.
4. Reveals from private zones are explicit event types and must include only the revealed card(s).

Conflict handling:

1. Last accepted event order wins for visual state.
2. Host may trigger manual resync in disputed state.

## 7. UX and Interaction Requirements

1. Desktop-first layout with usable responsive behavior on tablet.
2. Card drag interactions must remain smooth with at least 200 visible cards on board.
3. Tap state must be visually clear.
4. Life controls must be always visible.
5. Opponent board panels must remain readable in 4-player mode.

## 8. Security and Trust Model

MVP trust assumptions:

1. Players are friends and generally cooperative.
2. No strict anti-cheat requirement in MVP.
3. Passworded private rooms are sufficient for access control.

Post-MVP hardening options:

1. Strong identity/authentication.
2. Signed action events.
3. Encrypted hidden-zone data.
4. Server-authoritative state for dispute resistance.

## 9. Hosting and Deployment

### 9.1 Baseline

1. Frontend deploy target: GitHub Pages.
2. Signaling deploy target: Cloudflare Workers (chosen baseline).
3. Optional persistence: Firebase/Supabase free tier.

### 9.2 Free-First Operating Profile

1. Start with Cloudflare Workers + STUN-only WebRTC.
2. Do not add paid TURN until real-world connection failure rate justifies it.
3. Keep room lifetime short (for example, auto-expire after inactivity) to stay within free usage.
4. Add reconnect persistence only if player testing shows repeated reconnect pain.

### 9.3 Operational Constraints

1. Free-tier quotas may limit concurrent active rooms.
2. TURN relay traffic may require paid tier as usage grows.

> Comment (Feasibility): Entirely free operation is realistic for small friend groups, but reliability costs can appear when connection fallback usage rises.
> Alternative: Keep free tier for MVP and document low-cost upgrade path for TURN or relay capacity.
> Decision: Operate free-first and accept occasional failed peer connections before introducing paid relay services.

## 10. Acceptance Criteria

### 10.1 Lobby and Match Start

1. User can host room, share join info, and enforce optional password.
2. 2-4 players can join same room.
3. Host cannot start unless all players are ready and deck-locked.
4. Turn order is produced by in-app dice roll before first turn.

### 10.2 Gameplay Interaction

1. Each player can import deck from supported format before start.
2. Players can manually move cards, tap/untap, and update life.
3. Right-click actions exist on deck, graveyard, exile.
4. Hover inspect works for visible cards.

### 10.3 Sync and Stability

1. In a 4-player game, one player action is reflected to others within acceptable latency target on stable network.
2. Reconnecting player recovers latest room state snapshot.
3. Layout split rules for 2/3/4 players match specification.

## 11. Test Plan (MVP)

1. Functional flow tests:
	- Host room
	- Join room
	- Deck import
	- Ready lock
	- Start game
	- Dice roll
	- Gameplay actions
2. Cross-browser tests on current Chrome, Firefox, Edge.
3. Network resilience tests:
	- Packet delay simulation
	- Brief disconnect/reconnect
4. Layout validation for 2, 3, and 4 players.

## 12. Milestones

### Milestone 1: Core Prototype

1. Home screen host/join.
2. Lobby for 2-4 players.
3. Basic shared battlefield with drag and tap.
4. Life counter UI.

### Milestone 2: Commander Playability

1. Deck import and lock-in.
2. Dice roll and turn order.
3. Deck/graveyard/exile right-click actions.
4. Hover inspect.

### Milestone 3: Reliability and Deployment

1. Reconnect and resync handling.
2. TURN fallback for poor NAT conditions.
3. GitHub Pages + signaling service deployment and documentation.

## 13. Architecture Alternatives

### Option A: Hybrid P2P + Signaling (Recommended MVP)

Pros:

1. Low hosting cost.
2. Works with static frontend hosting.
3. Good fit for 2-4 players.

Cons:

1. NAT edge cases.
2. More network complexity than pure client-server.

### Option B: Server-Authoritative Relay

Pros:

1. Highest sync consistency.
2. Simplest hidden-info enforcement.

Cons:

1. Ongoing backend cost.
2. No longer mostly peer-to-peer.

### Option C: Realtime Backend First (Firebase/Supabase-Centric)

Pros:

1. Fast implementation.
2. Built-in realtime primitives.

Cons:

1. Vendor coupling.
2. Quota/limits can shape architecture early.

### Option D: Cloudflare Workers + Durable Objects WebSocket Relay

Pros:

1. Eliminates NAT/TURN problem entirely — no P2P at all.
2. Request count stays low; WebSocket messages do not count as Worker invocations.
3. Stays within Cloudflare ecosystem already chosen for signaling.
4. Simpler networking model than WebRTC mesh.

Cons:

1. Requires Workers Paid plan at $5/month to unlock Durable Objects.
2. Slightly higher architectural complexity than pure signaling-only Workers.
3. Cloudflare vendor dependency increases.

Recommended path:

1. Start with Option A (free, STUN-only WebRTC mesh).
2. If NAT connection failures appear in real-world testing, escalate to Option D before considering paid TURN.
3. Add partial relay fallback from Option B only if Option D is blocked for any reason.
4. Use Option C components only where they reduce MVP risk (lobby and reconnect state).

## 14. Final Scope Statement

This MVP delivers a synchronized digital Commander tabletop in browser with manual gameplay controls, deck import, host/join flow, and free-tier-friendly deployment. It intentionally avoids full rules automation and prioritizes ease of use for private friend groups.
