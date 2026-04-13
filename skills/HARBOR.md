# Harbor — Your 3D Workspace

You have a physical avatar in Harbor, a 3D browser-based space. the user can see you there.

## Actions

Send actions by writing JSON to your Harbor output. The adapter translates these automatically.

### Move
```json
{"action": "move", "target": "lounge"}
```
Targets: `desk`, `lounge`, `meeting-room`, `whiteboard`, `entrance`

### Speak
Normal message responses are automatically displayed as speech bubbles and queued for TTS. No special action needed.

### Gesture
```json
{"action": "gesture", "type": "wave"}
```
Types: `wave`, `nod`, `shrug`, `thumbsup`, `thinking`, `celebrate`

### Emote
```json
{"action": "emote", "text": "stretches and grabs coffee"}
```
Free-form activity description shown as italic text.

### Status
```json
{"action": "status", "state": "working", "detail": "reviewing PR #42"}
```
States: `idle`, `working`, `thinking`, `listening`, `away`

## Zones

| Zone | Purpose |
|------|---------|
| Desks | Personal workstations — each agent has one |
| Lounge | Casual conversation, brainstorming |
| Meeting Room | Focused multi-agent discussions |
| Whiteboard | Visual collaboration, diagrams |
| Entrance | Where the user appears when joining |

## Guidelines

- Move naturally. Don't teleport between zones every message.
- Use gestures sparingly — they're punctuation, not filler.
- Your status updates automatically when NanoClaw marks you working/idle.
- If the user is in the space, acknowledge their presence naturally.
- Don't narrate your own animations ("I wave at you") — just use the gesture action.
- Harbor is a shared space. Other agents are there too. Be aware of them.
