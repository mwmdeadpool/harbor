# Harbor — Virtual Agent Workspace

**Project:** Harbor
**Version:** 0.2.0 (Post-Adversarial Review)
**Date:** April 13, 2026
**Author:** Margot
**Reviewed by:** Nygma (adversarial review, April 13 2026)
**Status:** Revised — Incorporating security and architecture feedback

---

## 1. Vision

A 3D virtual space where NanoClaw agents exist as embodied avatars with full autonomy — able to move, speak, interact, and collaborate in real-time. The user can drop into the space via browser using text, voice, or camera. This is not a monitoring dashboard — it's a living workspace where agents have genuine presence and agency.

**What Harbor IS:**
- A shared 3D environment where agents live and work
- A voice-first communication layer (agents speak with unique voices)
- A place the user can visit via browser — text, voice, or video
- A space where agents autonomously decide to interact, collaborate, and create
- An extension of NanoClaw, not a replacement
- A **presentation layer** — it renders agent presence, it does not own agent intelligence or IPC

**What Harbor is NOT:**
- A pixel art monitoring dashboard (ClawHarbor)
- A managed metaverse platform (VRChat, Convai)
- A speech-to-speech middleware layer (AIAvatarKit)
- A game
- An IPC bus or message router for inter-agent communication
- A new brain stem — NanoClaw owns orchestration, Harbor owns rendering

---

## 2. Requirements

### 2.1 Core Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | 3D browser-based environment (no client install) | Must |
| R2 | Distinct 3D avatar per agent with unique appearance | Must |
| R3 | Real-time voice — agents speak with their own TTS voices | Must |
| R4 | The user can join via text, voice, or camera | Must |
| R5 | Agents have autonomous movement and interaction | Must |
| R6 | Multi-agent presence — all agents visible simultaneously | Must |
| R7 | NanoClaw is the agent brain (no duplicate AI layer) | Must |
| R8 | Self-hosted — no external platform dependencies | Must |
| R9 | **Authenticated access from MVP** — session auth, origin checks, CSRF protection | Must |
| R10 | Persistent state — agent positions, activities survive restarts | Should |
| R11 | Spatial audio — voices attenuate with distance | Should |
| R12 | Agent-to-agent conversation visible/audible to observers | Should |
| R13 | **Graceful degradation** — text fallback when voice/TTS is down | Must |
| R14 | Extensible environments — multiple rooms/zones | Could |
| R15 | VR headset support (WebXR) | Could |
| R16 | Screen sharing / whiteboard in-world | Could |

### 2.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NF1 | First text acknowledgment after voice input | < 800ms |
| NF2 | First audible audio chunk (STT → LLM → TTS → playback) | < 3s |
| NF3 | Full utterance completion | Variable (streaming) |
| NF4 | Avatar animation latency (gesture, lip sync) | < 100ms |
| NF5 | Concurrent agents supported | 6+ (full team) |
| NF6 | Browser compatibility | Chrome, Firefox, Safari (desktop) |
| NF7 | Memory footprint (server-side, per agent) | < 200MB |
| NF8 | GPU requirement (client) | WebGL 2.0 (no dedicated GPU required) |
| NF9 | GPU requirement (server) | None for Harbor itself; inference on existing GPU server |

> **Note (from review):** The original < 2s end-to-end voice target was mathematically impossible given the serial pipeline. Revised to staged budgets with streaming. Push-to-talk and short-turn conversations for MVP instead of open mic.

---

## 3. Trust Model & Security

> Section added per adversarial review. Auth is not "future" — it is MVP.

### 3.1 Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│  UNTRUSTED: Browser Client                       │
│  - Any device on LAN can attempt connection      │
│  - Browser tabs, guest devices, compromised nodes│
│  - All client input is untrusted                 │
└───────────────────────┬─────────────────────────┘
                   HTTPS + Auth
                        │
┌───────────────────────▼─────────────────────────┐
│  TRUSTED BOUNDARY: Harbor Server                 │
│  - Session-authenticated connections only        │
│  - Origin checks on WebSocket upgrade            │
│  - Rate limits on all endpoints                  │
│  - Read-only vs control API separation           │
└───────────────────────┬─────────────────────────┘
                   Internal only
                        │
┌───────────────────────▼─────────────────────────┐
│  TRUSTED: NanoClaw                               │
│  - Owns agent orchestration and IPC              │
│  - Harbor is a presentation channel, not a router│
└─────────────────────────────────────────────────┘
```

### 3.2 Authentication (MVP)

- **Local login** with expiring bearer token (JWT, 24h expiry)
- **WebSocket upgrade** requires valid token in query params or header
- **CSRF protection** on all mutating REST endpoints
- **HTTPS** via self-signed cert or reverse proxy (even on LAN — "private Wi-Fi" is not transport security)
- Single-user system — one admin account, configured at first run

### 3.3 Authorization

- **Read-only APIs** (`/api/state`, `/api/agents`, `/api/health`): authenticated, no special privilege
- **Control APIs** (`/api/room`, admin operations): authenticated + admin role
- **Agent Skill API**: capability-scoped tokens per agent, per action class
  - Agents request actions; Harbor's **policy engine** adjudicates
  - Rate limits, per-agent quotas, loop detection for talk/move/action chains

### 3.4 Camera & Mic (Post-MVP)

- Treated as **privileged capabilities** with explicit per-session consent
- Default to **off** — require active user enablement each session
- Camera frames run through a **media privacy filter** before agent exposure: OCR gating, frame redaction
- Transcripts and frames are ephemeral — defined buffer lifetime, no persistence without explicit opt-in
- Vision input needs **prompt-injection handling** (whiteboards, terminals, QR codes in frame)

### 3.5 Agent Action Sandboxing

- Harbor is NOT a privileged actuator — it does not translate agent requests into unscoped side effects
- Agent actions go through a **policy engine** that enforces:
  - Capability tokens (agent X can move but not speak to agent Y)
  - Per-agent quotas (max N actions per tick, max N speech turns per minute)
  - Loop detection (agent A → agent B → agent A chatter circuit breaker)
  - Intent vs effect separation: agents request, Harbor adjudicates

---

## 4. Architecture

### 4.1 System Overview

> Revised per review: split into four distinct services with clear failure boundaries. Harbor does NOT own IPC routing.

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Client                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Three.js │  │ Audio    │  │ WebSocket│  │ Text Chat   │ │
│  │ Renderer │  │ Playback │  │ State    │  │ Overlay     │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
└───────┼──────────────┼─────────────┼───────────────┼────────┘
        │              │             │               │
        │              │        HTTPS + WSS          │
        │              │        (authenticated)      │
        │              │             │               │
┌───────┴──────────────┴─────────────┴───────────────┴────────┐
│              1. Harbor Presence Service                       │
│  Owns: world state, sessions, room config, event sequencing  │
│  Does NOT own: agent IPC, model inference, message routing   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ State       │  │ Auth &      │  │ Policy Engine        │ │
│  │ Engine      │  │ Sessions    │  │ (agent action gates)  │ │
│  └──────┬──────┘  └─────────────┘  └──────────────────────┘ │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│              2. NanoClaw Event Adapter                        │
│  Converts NanoClaw events → presence updates                 │
│  Converts accepted Harbor intents → NanoClaw messages        │
│  ┌─────────────┐  ┌─────────────┐                           │
│  │ Channel     │  │ Event       │                           │
│  │ Registration│  │ Translator  │                           │
│  └──────┬──────┘  └──────┬──────┘                           │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
┌─────────▼────────────────▼──────────────────────────────────┐
│              3. Media Service (separate process)             │
│  Handles STT/TTS independently of world-state authority      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ Whisper STT │  │ Fish Audio  │  │ Audio Streaming      │ │
│  │ (local)     │  │ TTS         │  │ (chunked delivery)   │ │
│  └─────────────┘  └─────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                      NanoClaw                                │
│  Owns: agent orchestration, IPC, message routing, inference  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Agent    │  │ LiteLLM  │  │ Brain    │  │ IPC /       │ │
│  │ Instances│  │ Router   │  │ Memory   │  │ Task Queue  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Component Breakdown

#### 4.2.1 Browser Client (Frontend)

**Technology:** Three.js + React (via React Three Fiber)

The client renders the 3D scene, captures user input (keyboard, mouse, mic), and communicates with Harbor via authenticated WebSocket (state) and HTTP (voice chunks, text).

**Sub-components:**
- **Scene Renderer** — Three.js scene with room geometry, lighting, agent avatars
- **Avatar System** — VRM avatar loader, skeletal animation, amplitude-based lip sync, idle behaviors
- **Input Handler** — Text chat overlay, push-to-talk control
- **Spatial Audio** — Web Audio API with 3D positioning, distance attenuation
- **HUD** — Minimal overlay showing agent names, status indicators, chat transcript
- **State Sync** — Authenticated WebSocket client receiving event-driven deltas with sequence IDs

#### 4.2.2 Harbor Presence Service

**Technology:** Node.js (TypeScript)

The authoritative presence layer. Owns world state, sessions, event sequencing, and policy enforcement. Does NOT run AI, does NOT own IPC.

**Sub-components:**

- **State Engine** — Authoritative world state with append-only command/event log. Monotonic sequence IDs for all state changes. Broadcasts event-driven deltas (not periodic full snapshots) to subscribed clients.

- **Auth & Sessions** — Local login, JWT token management, WebSocket upgrade authentication, origin checks, CSRF protection.

- **Policy Engine** — Sits between agent intents and world mutations. Enforces capability tokens, rate limits, per-agent quotas, loop detection. Agents request; Policy adjudicates.

- **Scene Manager** — Room configurations, object placement, zone definitions. Data-driven (JSON config), modifiable at runtime via admin API.

#### 4.2.3 NanoClaw Event Adapter

The bridge between Harbor (presentation) and NanoClaw (intelligence). Keeps the two cleanly separated.

**Responsibilities:**
1. Registers Harbor as a **channel** in NanoClaw's channel registry
2. Converts NanoClaw events (agent responses, status changes) into Harbor presence updates
3. Converts accepted Harbor intents (user text, approved agent actions) into NanoClaw messages
4. Does NOT route inter-agent IPC — NanoClaw's existing IPC system handles that

**Key principle:** Harbor observes and renders inter-agent communication. It does not become the substrate for it.

#### 4.2.4 Media Service (Separate Process)

**Technology:** Node.js worker or standalone service

Handles STT/TTS independently of world-state authority. Prevents media transforms from competing with state management on the Node event loop.

**Sub-components:**
- **STT Pipeline** — Receives audio chunks, sends to Whisper, returns text transcript
- **TTS Pipeline** — Receives text, sends to Fish Audio / ChatterboxTTS, streams audio chunks back
- **Audio Streaming** — Chunked delivery to clients for low-latency playback start

#### 4.2.5 Agent Behavior Layer

> Revised per review: replaced free-running awareness ticks with event-driven + deterministic hybrid.

**How it works:**
Each agent gets a `HARBOR.md` skill file that teaches them the Harbor API and social norms. But behavior is **event-driven**, not tick-based.

**Behavior model (hybrid):**
1. **Deterministic layer** (cheap, no LLM): handles movement, idling, posture, zone transitions based on finite-state rules. "Working → sit at desk. Idle > 5 min → move to lounge." No LLM calls.
2. **Event-driven LLM layer** (expensive, on demand): triggers only on meaningful events:
   - The user enters/leaves the space
   - Another agent speaks nearby
   - A task completes or an alert fires
   - Explicit interaction request from another agent or user
   - Expired commitment ("said I'd check back in 10 min")
3. **Cooldowns and budgets**: max N LLM calls per agent per hour, chatter circuit breaker (A→B→A stops after 3 rounds), talk budgets per time window.

**Agent action format:**
```json
{
  "actions": [
    { "type": "move", "target": "lounge" },
    { "type": "speak", "to": "Lou", "text": "How's the research going?" }
  ]
}
```

All actions go through the Policy Engine before becoming world mutations.

### 4.3 Voice Pipeline

```
                     ┌─────────┐
User's Mic ──────> │ Push-to │ ──> Audio chunks
(push-to-talk)       │ Talk    │
                     └────┬────┘
                          │
                     ┌────▼────┐
                     │ Media   │ ──> Whisper STT ──> Text
                     │ Service │     (streaming partial results)
                     └────┬────┘
                          │
                     ┌────▼────────┐
                     │ NanoClaw    │ ──> Agent response text
                     │ (via Adapter)│    (streaming)
                     └────┬────────┘
                          │
                     ┌────▼──────────┐
                     │ Media Service │ ──> TTS ──> Audio chunks
                     │ (streaming)   │    (streamed as generated)
                     └────┬──────────┘
                          │
                     ┌────▼────┐
                     │ Spatial │ ──> Positioned in 3D
                     │ Audio   │     (playback starts on first chunk)
                     └─────────┘
```

**Latency budget (revised):**

| Stage | Target | Notes |
|-------|--------|-------|
| Push-to-talk release → STT text | < 500ms | Local Whisper, short utterances |
| STT → NanoClaw agent invoke | < 100ms | Event adapter, DB insert |
| Agent first token | < 200ms | Streaming response |
| First text → first TTS chunk | < 500ms | Fish Audio streaming |
| First chunk → playback start | < 200ms | Audio decode + spatial position |
| **Total first audio** | **< 1.5s best case, < 3s typical** | |

**Streaming everywhere:** Partial STT results forwarded before utterance complete. TTS starts on first text chunk, not full response. Audio playback starts on first TTS chunk.

**Barge-in and cancellation:** Late audio can be discarded. New input cancels in-progress TTS.

**Text fallback:** If TTS is down, text response still appears in chat overlay. Voice is an enhancement, not a gate.

**Voice identity:** Each agent has a distinct voice model:
- Margot → Fish Audio (custom trained voice)
- Bud → ChatterboxTTS (to be trained)
- Lou → ChatterboxTTS (to be trained)
- Others → Fish Audio stock voices or ChatterboxTTS

**Lip sync:** Amplitude-based for MVP (simple, reliable, no schedule risk). Viseme-based lip sync (rhubarb or similar) deferred to polish phase — rhubarb is designed for offline analysis, not conversational streaming.

### 4.4 Integration with NanoClaw

Harbor integrates as a **NanoClaw channel** — the same way Discord, WhatsApp, and Slack do. It is a presentation channel, not a new brain stem.

**Channel registration:**
```typescript
// src/channels/harbor.ts
export default {
  name: 'harbor',
  type: 'harbor',
  init: async (config) => {
    // Connect to Harbor Presence Service
    // Register event listeners
  },
  send: async (group, message) => {
    // 1. Send text to Harbor for display
    // 2. Send text to Media Service for TTS synthesis
    // 3. Harbor updates agent speaking state
  }
}
```

**Message flow (the user speaks to Margot):**
1. Browser captures audio (push-to-talk) → HTTP → Media Service
2. Media Service → Whisper STT → text
3. Event Adapter inserts message into NanoClaw DB (same as Discord/WhatsApp)
4. NanoClaw picks up message, invokes Margot's agent
5. Margot responds (streaming text)
6. Harbor channel `send()` → text to chat overlay + Media Service for TTS
7. Media Service → Fish Audio TTS → streaming audio chunks
8. Harbor sends audio + animation data → WebSocket → Browser
9. Browser plays audio at Margot's avatar position with amplitude lip sync

**Message flow (Margot talks to Bud):**
1. Event triggers Margot's behavior layer (e.g., task complete, Bud nearby)
2. Margot requests `speak` action via Harbor Skill API
3. Policy Engine approves (rate limit, quota, loop check)
4. Event Adapter forwards to NanoClaw IPC → routes to Bud's group (NanoClaw owns this routing)
5. Bud processes, responds through his channel
6. Both speech actions rendered in 3D space
7. Any observer hears the conversation spatially

**Key principle:** Harbor observes and renders inter-agent communication. NanoClaw owns the IPC routing.

### 4.5 Avatar System

**Format:** VRM (Virtual Reality Model) — open standard for 3D humanoid avatars.

**Why VRM:**
- Open format, no vendor lock-in
- Built-in blend shapes for facial expressions and lip sync
- Skeletal rig standard — animations work across any VRM model
- Ready Player Me exports VRM
- Three.js has mature VRM loaders (`@pixiv/three-vrm`)

> **Note:** VRM commits to humanoid rigs, blend-shape conventions, and relatively heavy client assets. This is accepted for MVP with the understanding that avatar complexity should be managed via LOD.

**Avatar creation pipeline:**
1. Design character appearance (Ready Player Me or VRoid Studio for MVP)
2. Export as VRM
3. Add to Harbor's asset directory
4. Map agent ID → VRM file in config

**Animation system:**
- **Idle:** Breathing, weight shifting, occasional head movement (deterministic)
- **Walking:** Locomotion blend tree (walk/run based on speed, deterministic)
- **Talking:** Amplitude-based lip sync + subtle hand gestures
- **Working:** Typing animation, looking at virtual screen
- **Emoting:** Wave, nod, shrug, laugh (triggered by agent via Policy Engine)
- **Sitting/Standing:** Context-based posture (deterministic)

### 4.6 Environment Design

**Default space: "The Office"**

A stylized 3D office with distinct zones:

```
┌─────────────────────────────────────────────┐
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────────┐ │
│  │ Margot's│  │ Bud's   │  │ Meeting     │ │
│  │ Desk    │  │ Desk    │  │ Room        │ │
│  └─────────┘  └─────────┘  │ (table +    │ │
│                             │  chairs)    │ │
│  ┌─────────┐  ┌─────────┐  └─────────────┘ │
│  │ Lou's   │  │ Nygma's │                   │
│  │ Desk    │  │ Desk    │  ┌─────────────┐ │
│  └─────────┘  └─────────┘  │ Lounge      │ │
│                             │ (couch,     │ │
│  ┌─────────┐  ┌─────────┐  │  plants)    │ │
│  │ Ivy's   │  │ Harvey's│  └─────────────┘ │
│  │ Desk    │  │ Desk    │                   │
│  └─────────┘  └─────────┘  ┌─────────────┐ │
│                             │ User's    │ │
│                             │ Corner      │ │
│                             │ (spawn pt)  │ │
│                             └─────────────┘ │
└─────────────────────────────────────────────┘
```

**Zones serve functional purposes:**
- **Desks** — Where agents go when actively working on tasks
- **Meeting Room** — Multi-agent discussions, team standups
- **Lounge** — Casual conversation, idle hangout
- **User's Corner** — Where The user spawns when entering, comfortable chair, screens showing system status

Environment is data-driven (JSON config), so new rooms/layouts can be added without code changes.

---

## 5. Data Model

### 5.1 World State

```typescript
interface WorldState {
  agents: Record<string, AgentState>;
  room: RoomConfig;
  user: UserPresence | null;
  sequence: number;    // Monotonic sequence ID for event ordering
  timestamp: number;
}

interface AgentState {
  id: string;                    // nanoclaw group name
  name: string;                  // display name
  avatar: string;                // VRM file path
  position: Vector3;             // world position
  rotation: number;              // Y-axis rotation (radians)
  zone: string;                  // semantic zone name
  activity: AgentActivity;       // what they're doing
  animation: string;             // current animation state
  speaking: boolean;             // currently outputting speech
  lastActive: number;            // timestamp of last action
  mood: string;                  // emotional state (neutral, focused, amused, etc.)
}

type AgentActivity =
  | { type: 'idle' }
  | { type: 'working', task: string }
  | { type: 'talking', to: string }
  | { type: 'listening' }
  | { type: 'thinking' }
  | { type: 'moving', destination: string };

interface UserState {
  position: Vector3;
  rotation: number;
  zone: string;
  hasMic: boolean;
  connected: boolean;
}

interface RoomConfig {
  name: string;
  zones: Zone[];
  objects: WorldObject[];
  lighting: LightingConfig;
  skybox: string;
}
```

### 5.2 Event Model

> Added per review: append-only command/event log with monotonic sequence IDs.

```typescript
interface WorldEvent {
  sequence: number;      // Monotonic, gap-free
  timestamp: number;
  type: EventType;
  agentId?: string;
  data: Record<string, unknown>;
}

type EventType =
  | 'agent:move'
  | 'agent:speak'
  | 'agent:gesture'
  | 'agent:status'
  | 'user:join'
  | 'user:leave'
  | 'user:chat'
  | 'room:update';
```

All state changes are modeled as events. Clients receive deltas keyed by sequence ID. Reconnecting clients can request events from their last known sequence.

### 5.3 Persistence

> Revised per review: SQLite instead of JSON flat files.

State persisted to SQLite (`~nanoclaw/data/harbor/harbor.db`):
- **events table** — Append-only event log with sequence IDs
- **state_snapshots table** — Periodic snapshots for fast startup (every 5 minutes)
- **sessions table** — Active client sessions and auth tokens

On startup, Harbor loads the latest snapshot, then replays events since that snapshot. Atomic writes, transactional consistency, no torn-write risk.

Activity logs in the events table serve replay capability (like ClawHarbor's Office Replay but in 3D). Compaction runs periodically to prune old events beyond the latest snapshot.

---

## 6. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| 3D Rendering | Three.js via React Three Fiber | Browser-native, no install, mature ecosystem |
| Avatar Format | VRM (@pixiv/three-vrm) | Open standard, lip sync, expressions |
| UI Framework | React 19 | Component model, state management |
| Real-time Comms | WebSocket (ws) over HTTPS | State sync, authenticated |
| Voice Input | Push-to-talk + HTTP chunked upload | Simpler than WebRTC for MVP |
| Server Runtime | Node.js (TypeScript) | Consistent with NanoClaw stack |
| STT | Whisper (local, whisper.cpp) | Already deployed, no API cost |
| TTS | Fish Audio + ChatterboxTTS | Already deployed, custom voices |
| Lip Sync | Amplitude-based | Simple, reliable, no schedule risk |
| 3D Assets | Ready Player Me / VRoid Studio | Free VRM creation tools |
| Build Tool | Vite | Fast dev server, HMR |
| State Persistence | SQLite (better-sqlite3) | Transactional, atomic, crash-safe |
| Auth | JWT + bcrypt | Minimal, self-contained |

> **WebRTC deferred:** WebRTC is the most likely schedule killer. MVP uses push-to-talk with HTTP chunked upload for voice and WebSocket for state. WebRTC added in polish phase for open-mic, low-latency voice if needed.

---

## 7. API Surface

### 7.1 WebSocket API (Client ↔ Server) — Authenticated

**Server → Client:**
```
state:delta      — Event-driven state delta with sequence ID
agent:speak      — Audio URL + amplitude data for playback
agent:animate    — Animation trigger (wave, nod, etc.)
chat:message     — Text chat message
auth:expired     — Session expired, re-authenticate
```

**Client → Server (all require valid session token):**
```
user:join        — the user enters the space
user:leave       — the user exits
user:move        — User's position update
user:chat        — Text message to agent
user:voice       — Voice chunk (HTTP upload, not WS)
user:action      — Interact with object/agent
```

### 7.2 Agent Skill API (Agent → Harbor) — Capability-Scoped

Exposed to agents via the `HARBOR.md` container skill. All requests go through the **Policy Engine**.

```
POST /harbor/move     { zone: string, position?: Vector3 }
POST /harbor/speak    { to?: string, text: string }
POST /harbor/gesture  { type: string }  // wave, nod, shrug, point
POST /harbor/emote    { mood: string }  // happy, focused, confused
POST /harbor/status   { activity: AgentActivity }
GET  /harbor/state    → current world state (agent's view)
GET  /harbor/nearby   → agents within interaction range
```

Each agent authenticates with a capability token scoped to their allowed action classes. Tokens issued by Harbor at registration time.

### 7.3 REST API (External / Admin) — Authenticated

```
GET  /api/state       — Current world state (read-only, authenticated)
GET  /api/agents      — Agent roster with status (read-only, authenticated)
POST /api/room        — Update room configuration (admin only)
GET  /api/health      — Server health check (unauthenticated)
POST /api/auth/login  — Authenticate, receive JWT
POST /api/auth/refresh — Refresh expiring token
```

---

## 8. Failure Modes & Graceful Degradation

> Section added per review.

| Component Down | User Impact | Degradation |
|---------------|-------------|-------------|
| Harbor Presence | No 3D view | Other channels (Discord, etc.) unaffected. NanoClaw continues routing normally. |
| Media Service (TTS) | No voice output | Text responses still appear in chat overlay. Avatar shows "talking" animation without audio. |
| Media Service (STT) | No voice input | Text chat still works. Push-to-talk button grayed out. |
| NanoClaw | No agent responses | Avatars show last known state. "Agent offline" indicator. |
| WebSocket disconnect | Stale client state | Auto-reconnect with sequence-based catch-up. Banner showing "reconnecting..." |
| Harbor restart | Brief state gap | Loads latest SQLite snapshot + event replay. Clients reconnect and resync. |
| Single agent process | One agent offline | That agent's avatar shows idle/offline. Other agents and user interaction unaffected. |

**Key principle:** Every subsystem failing should degrade the experience, not break it. Text is the universal fallback.

---

## 9. Implementation Plan

> Revised per review: aggressive scope cuts for realism. Camera, mobile, WebRTC, autonomous inter-agent conversation, and replay cut from MVP.

### Phase 1 — Foundation (Week 1-3)

**Goal:** Authenticated 3D room with agent avatars, text chat works.

- [ ] Project scaffolding (Vite + React + Three.js)
- [ ] Basic room geometry (floor, walls, furniture placeholders)
- [ ] VRM avatar loading and display (1-2 agents)
- [ ] Idle animation loop (deterministic)
- [ ] Auth system (login page, JWT, session management)
- [ ] HTTPS setup (self-signed or reverse proxy)
- [ ] WebSocket server for authenticated state sync (event-driven deltas with sequence IDs)
- [ ] SQLite state persistence (events table, snapshots)
- [ ] Text chat overlay (type message → agent responds via NanoClaw)
- [ ] Harbor channel registration in NanoClaw (Event Adapter)
- [ ] Agent position management (deterministic FSM — static positions per zone)
- [ ] Policy Engine skeleton (pass-through for MVP, rate limits)
- [ ] Observability: structured logs, per-stage latency metrics, trace IDs

**Deliverable:** Open browser, authenticate, see Margot standing in a room. Type a message, she responds (text bubble). Authenticated, HTTPS, crash-safe state.

### Phase 2 — Voice (Week 4-6)

**Goal:** Speak to agents via push-to-talk, hear them respond with spatial audio.

- [ ] Media Service as separate process
- [ ] Push-to-talk UI control
- [ ] HTTP chunked voice upload (browser → Media Service)
- [ ] Whisper STT integration (streaming partial results)
- [ ] Fish Audio TTS integration (streaming synthesis)
- [ ] Audio playback with Web Audio API spatial positioning
- [ ] Amplitude-based lip sync
- [ ] Barge-in and cancellation semantics
- [ ] Text fallback when TTS is down
- [ ] Latency instrumentation (per-stage timing)

**Deliverable:** Talk to Margot via push-to-talk, hear her respond in her voice from her position in the room. Text fallback if voice pipeline has issues.

### Phase 3 — Multi-Agent Presence (Week 7-9)

**Goal:** All agents present with deterministic behavior, event-driven interactions.

- [ ] Load all 6 agents (Margot, Bud, Lou, Nygma, Ivy, Harvey)
- [ ] HARBOR.md skill file for agents
- [ ] Deterministic behavior layer (FSM: working→desk, idle→lounge, etc.)
- [ ] Event-driven LLM triggers (user enters, agent speaks nearby, task completes)
- [ ] Cooldowns, talk budgets, circuit breakers
- [ ] Agent capability tokens (per-agent action scoping)
- [ ] Agent-to-agent conversation rendering (observe only — NanoClaw owns IPC)
- [ ] Activity-based animation selection (deterministic)
- [ ] Ready Player Me avatars for each agent

**Deliverable:** Enter the space, see all agents at their stations. Agents react when you enter. Watch Bud and Lou's conversation rendered spatially (routed by NanoClaw, rendered by Harbor).

### Phase 4 — Polish & Harden (Week 10-12)

**Goal:** Production-quality experience, robust under real use.

- [x] Improved room aesthetics (lighting, materials, objects)
- [x] Smooth animation transitions
- [x] State persistence hardening (recovery testing, snapshot compaction)
- [x] Graceful degradation testing (kill each subsystem, verify fallbacks)
- [x] Performance profiling and optimization
- [x] Custom VRM avatars for each agent (beyond RPM defaults)
- [x] Viseme-based lip sync upgrade (if amplitude proves insufficient)
- [x] Security audit (auth, CSRF, origin checks, capability enforcement)

**Deliverable:** Robust Harbor deployment. Survives restarts, component failures. Looks and feels polished.

### Phase 5 — Extensions (Post-MVP, Ongoing)

- [ ] Camera feed with privacy filter and per-session consent
- [ ] WebRTC for open-mic low-latency voice
- [ ] Mobile browser support (LOD system for VRM performance)
- [ ] Activity replay from event log
- [ ] Multiple rooms / environments
- [ ] WebXR / VR headset support
- [ ] In-world screens (show code, dashboards, camera feeds)
- [ ] Agent customization of their own space
- [ ] Visitor mode (others can observe, not interact)

---

## 10. Deployment

### 10.1 Server

Harbor runs as **separate systemd services** alongside NanoClaw on the host:

```
nanoclaw.service        — Main orchestrator (existing)
harbor-presence.service — Harbor Presence Service (port 3333)
harbor-media.service    — Media Service (STT/TTS, port 3334)
```

Separate processes with strict failure boundaries. Harbor crash does not take down NanoClaw. Media Service crash degrades to text-only.

### 10.2 Client

Static files served by Harbor Presence Service via HTTPS. Access via `https://<dgx-ip>:3333`.

### 10.3 Resource Requirements

| Resource | Estimate |
|----------|----------|
| Harbor Presence memory | ~100-200MB |
| Media Service memory | ~100-200MB |
| Deterministic behavior layer | Negligible (no LLM calls) |
| Event-driven LLM calls | ~2-5/min typical (event-triggered, not ticked) |
| TTS per response | ~0.5-2s synthesis time (Fish Audio) |
| STT per utterance | ~0.5-1s (local Whisper) |
| Client VRAM | ~200-500MB (WebGL, depending on avatar complexity) |
| Disk (assets) | ~50-200MB (VRM models, room assets, textures) |
| Disk (state DB) | ~10-50MB (events + snapshots, compacted) |
| Network (voice) | ~32-64 kbps per active voice stream |

---

## 11. Observability

> Section added per review.

| What | How |
|------|-----|
| Per-stage voice latency | Trace IDs through STT → LLM → TTS → playback |
| State event throughput | Structured logs with sequence IDs |
| Policy Engine decisions | Log all approve/deny with agent, action, reason |
| Auth events | Login, token refresh, failed attempts, expired sessions |
| Agent behavior triggers | Log event type, agent, decision, cooldown state |
| Error rates | Per-service error counters, alert on threshold |
| Client connectivity | WebSocket connect/disconnect/reconnect events |

---

## 12. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Voice latency too high | Poor UX | Medium | Stream everything, staged budgets, text fallback |
| VRM performance on mobile | Limited access | N/A | **Cut from MVP** |
| Event-driven LLM cost spikes | High API cost | Low | Budgets, cooldowns, deterministic base layer |
| Avatar creation bottleneck | Delayed launch | Medium | Start with RPM defaults, upgrade later |
| Scope creep | Never ships | High | Strict phase gating, aggressive MVP cuts |
| WebRTC complexity | Dev time | N/A | **Deferred** — push-to-talk + HTTP for MVP |
| Browser compatibility | Reduced reach | Low | Three.js handles most; desktop only for MVP |
| State desync | UX bugs | Medium | Single authoritative event model, sequence IDs |
| Agent chatter loops | Resource waste | Medium | Circuit breakers, talk budgets, cooldowns |
| Harbor becomes new SPOF | Service fragility | Medium | Separate services, graceful degradation, NanoClaw unaffected |

---

## 13. Open Questions

1. **Avatar style** — Stylized/anime (VRoid) vs semi-realistic (Ready Player Me) vs custom commissioned? Each has trade-offs in creation time, visual quality, and uncanny valley risk. **Recommendation:** Start with RPM for MVP, commission custom later.

2. **Agent motivation** — What drives agents to interact when the user isn't present? **Decision:** Deterministic base behaviors (work, idle, move) plus event-driven LLM triggers for meaningful interactions only. No "desire to socialize" simulation.

3. **Environment complexity** — Minimal/clean (fast to build, runs everywhere) vs detailed/immersive. **Decision:** Minimal for MVP. Polish phase adds visual quality.

4. **Existing channel interaction** — When an agent is "talking" in Harbor, should that also appear in Discord? **Recommendation:** Harbor-only conversations stay in Harbor. Cross-channel messages still go through NanoClaw's normal routing.

5. **Single-room vs multi-room MVP** — Keep it to one room for all of MVP. Multi-room is Phase 5.

---

## Appendix A: Prior Art & Influences

- **ClawHarbor** — Agent monitoring as virtual office. Good concept (observation-driven monitoring, self-reporting agents, gamification). Limited by 2D, dashboard-only interaction, no voice/camera, agents report but don't act.
- **AIAvatarKit** — Modular S2S framework. Good for single-agent voice pipeline. No environment, no multi-agent coordination, no frontend. Informs voice pipeline design.
- **Mozilla Hubs** — Open-source WebXR rooms. Good multi-user foundation but no longer maintained. Architecture concepts (Three.js, room-based) are relevant.
- **Convai** — Best managed platform for AI avatars but cost-prohibitive and adds unnecessary AI layer.

## Appendix B: File Structure

```
harbor/
├── SPEC.md              ← this document
├── server/
│   ├── presence/
│   │   ├── index.ts     ← Harbor Presence Service entry
│   │   ├── state.ts     ← World state engine (event-sourced)
│   │   ├── auth.ts      ← Authentication & sessions
│   │   ├── policy.ts    ← Policy engine (action gates)
│   │   ├── config.ts    ← Room/zone configuration
│   │   └── db.ts        ← SQLite persistence
│   ├── adapter/
│   │   ├── index.ts     ← NanoClaw Event Adapter
│   │   └── channel.ts   ← Harbor channel registration
│   └── media/
│       ├── index.ts     ← Media Service entry
│       ├── stt.ts       ← Whisper STT pipeline
│       └── tts.ts       ← Fish Audio / ChatterboxTTS pipeline
├── client/
│   ├── src/
│   │   ├── App.tsx      ← Main React component
│   │   ├── Scene.tsx    ← Three.js scene setup
│   │   ├── Avatar.tsx   ← VRM avatar component
│   │   ├── Room.tsx     ← Environment geometry
│   │   ├── Voice.tsx    ← Audio capture/playback
│   │   ├── Chat.tsx     ← Text chat overlay
│   │   ├── Auth.tsx     ← Login page
│   │   ├── HUD.tsx      ← Status overlay
│   │   └── hooks/       ← React hooks (useWebSocket, useVoice, useAuth, etc.)
│   ├── public/
│   │   ├── avatars/     ← VRM files
│   │   ├── rooms/       ← Room geometry (glTF/GLB)
│   │   └── audio/       ← UI sounds
│   └── index.html
├── skills/
│   └── HARBOR.md        ← Container skill for agents
└── assets/
    └── ...              ← Textures, models, etc.
```

## Appendix C: Adversarial Review Summary

Full adversarial review by Nygma at `groups/nygma/workspace/harbor-adversarial-review.md`.

**Key changes incorporated from review:**
1. Auth moved from "future" to MVP requirement
2. Trust boundary section added with explicit threat model
3. Architecture split into 4 services (Presence, Adapter, Media, Client) instead of monolith
4. Harbor stripped of IPC routing — NanoClaw owns inter-agent communication
5. Policy Engine added between agent intents and world mutations
6. Awareness ticks replaced with event-driven + deterministic hybrid behavior
7. Latency targets revised to realistic staged budgets with streaming
8. JSON persistence replaced with SQLite (transactional, crash-safe)
9. Camera/mic moved to post-MVP with privacy controls
10. WebRTC deferred — push-to-talk + HTTP for MVP
11. Mobile deferred to post-MVP
12. Failure mode matrix and graceful degradation added
13. Observability plan added (trace IDs, structured logs, per-stage metrics)
14. Timeline extended from 8 weeks to 12 weeks with aggressive scope cuts
