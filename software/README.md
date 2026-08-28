# PUNCH ENGLISH

A rhythm-boxing game for learning English, in the browser. You are in a fight
with a monster, and English is your weapon. A question appears, three answer
blocks rush in and hold while you read them — **walk to the answer you want,
then punch it**. Get it right and the monster takes the hit. Get it wrong and it
gets a turn.

It is a **one-handed** game: a single fist throws every punch, reaching toward
whichever answer you commit to.

Not VR — mouse and keyboard — but the input layer is built so a webcam tracker
or an ESP32 motion controller can be dropped in without touching gameplay code.

## The fight

```
move to an answer → punch → correct   → the monster loses HP
                          → wrong/miss → the monster winds up an attack
                                       → block it, or lose HP
```

- **Answering is two steps.** A punch only counts for the answer you are
  actually standing in front of. Punch from between lanes, or at a block you
  have not walked to, and it is a MISS — the game never guesses the nearest
  answer for you.
- **Level 1 is a diagnostic round.** The monster measures your English and never
  hits back. From level 2 the counter-attacks start.
- **Blocking is timed.** `Shift` raises your guard for less than a second, so
  holding it from the start of a wind-up leaves you open when the blow lands.
- **Five correct in a row** earns a Word Connect special attack: a short word is
  scattered around you, and connecting its letters in order builds a heavy hit.
  It is spent as a sequence rather than a single punch — a wind-up that drags
  the world in toward the monster, a barrage that runs one blow longer for
  every word connected, and a finisher that lands in slow motion.
- **Word Connect is hand only, and needs no punch.** Your feet stay planted in
  the centre for the whole mini game: reach up, down, left, or right and the
  letter connects the moment you get there. Walking and punching answer
  questions; reaching alone connects letters.

Levels come from the persisted learner profile, so a returning player resumes at
their real level rather than replaying the diagnostic.

## Run it

```bash
npm install
npm run test
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build
npm run lint
```

### Enable the AI curriculum coach

Copy `.env.example` to `.env.local`, then add your OpenRouter API key:

```dotenv
OPENROUTER_API_KEY=replace_with_a_new_openrouter_api_key
OPENROUTER_MODEL=openai/gpt-5.6-terra
```

Restart `npm run dev` after changing the environment file. The key is read only
by the local Vite server middleware and is never exposed through a `VITE_`
browser variable. OpenRouter requests require structured-output support, deny
provider data collection, and request zero-data-retention routing. If the key
or network is unavailable, the game clearly marks
the result as a local plan and uses a deterministic 30-question fallback with
10 easy, 10 medium, and 10 hard questions.

For deployment, move the `/api/punchkt/plan` middleware to an equivalent
server/serverless route and keep the same request and response contract.

## Adaptive learning flow

Adaptation is deliberately split across two timescales:

1. **During a level:** the existing deterministic rolling policy changes only
   easy/medium/hard difficulty. A missed block is treated as motor evidence,
   not an incorrect English answer.
2. **At level end:** a persistent PunchKT-style learner model creates a report
   containing concept mastery and uncertainty, chosen-distractor misconception
   evidence, retention/forgetting estimates, and separate punch timing signals.
3. **Between levels:** OpenRouter routes `openai/gpt-5.6-terra`, which returns strict structured data containing
   an evidence-grounded weakness explanation, a curriculum plan, and exactly 30
   new questions (10 easy, 10 medium, and 10 hard). The server checks shape, answer uniqueness, misconception
   alignment, duplicate stems, and the declared difficulty mix; it asks once
   for repair if validation fails.
4. **Next level:** only the validated question pool is installed. The LLM is not
   called during live gameplay and there is no adaptive boss challenge. The
   first level starts at easy; later levels retain the previous ending difficulty
   unless weak language evidence or a strong forgetting signal lowers it by one rung.

The learner profile is saved in browser local storage, allowing concepts whose
estimated retention has decayed between visits to be scheduled for review.

## Controls

| Input | Action |
| --- | --- |
| `←` `→` (or `A` `D`) | Walk between LEFT · CENTER · RIGHT |
| `← ↑ → ↓` (or `WASD`) | Reach at a letter to connect it, during Word Connect |
| `1` `2` `3` | Step straight to a lane |
| `Space` | Punch whatever you are standing in front of, or reaching at |
| `Shift` | Raise your guard |
| Mouse click | Punch a block — still only counts from its lane |
| `Esc` | Pause / resume |

## How it scores

Base 100 per correct answer, plus a timing bonus for how close to your fist the
block was when you punched it (PERFECT +50, GREAT +25, GOOD +10), all
multiplied by the combo tier:

| Combo | Multiplier |
| --- | --- |
| 0–2 | ×1 |
| 3–5 | ×2 |
| 6–9 | ×3 |
| 10+ | ×4 |

A wrong answer costs 50 points and breaks the combo, and the correct block
flashes green so you learn what you missed. Letting the row fly past also
breaks the combo. A round ends at 20 questions, 3:30, the monster's last hit
point, or yours — whichever comes first.

Damage is separate from score: a correct answer deals a base hit plus a bonus
for punch timing and one that grows with the combo. Every number lives in
`src/game/constants.ts`.

### Time to think

Blocks move in three phases, so reading and reacting do not compete:

1. **Entry** (0.55 s) — they rush in from down the tunnel to the read plane.
2. **Read** (1.0–2.0 s by difficulty) — they hold still, close to the camera and
   large enough that four answers are comfortably legible.
3. **Approach** (1.7–2.6 s) — they close on the player.

The timer bar under the question drains over exactly that whole window. Punching
during the read phase is allowed but scores no timing bonus, so patience pays.

Accuracy over the last five answers steers the difficulty: above 80% it steps
up (easy → medium → hard), below 50% it steps back down.

## Architecture

The rule is: **the simulation never imports React, and React never runs per
frame.**

```
src/
├── game/                       pure TypeScript, no React, no Three.js
│   ├── GameManager.ts          authoritative state + tick(dt) + event bus
│   ├── MonsterManager.ts       monster HP, wind-up timer, phase
│   ├── WordConnectManager.ts   the special-attack mini game
│   ├── wordBank.ts             picks puzzle words out of the question pool
│   ├── QuestionManager.ts      serves questions, trims 4 options to 3 lanes
│   ├── ScoreManager.ts         score and session statistics
│   ├── ComboManager.ts         streak and multiplier tiers
│   ├── DifficultyManager.ts    adaptive difficulty + learner signals
│   ├── AudioManager.ts         Web Audio synthesis (music + SFX, no assets)
│   ├── events.ts               typed pub/sub
│   ├── constants.ts            every tunable in one file
│   └── input/
│       ├── PunchEvent.ts       the one contract every input device speaks
│       ├── PlayerMotion.ts     stance, hand reach, and guard timing
│       ├── InputManager.ts     fans InputSources into one punch stream
│       └── HARDWARE.md         how to add an ESP32 / MediaPipe source
│
├── components/
│   ├── scene/                  React Three Fiber — reads game state in useFrame
│   ├── hud/                    DOM overlay, repaints only on discrete events
│   └── screens/                menu, how-to-play, settings, countdown, results
│
├── store/gameStore.ts          zustand mirror of the simulation, for the HUD
├── hooks/                      event subscription + narrow selectors
├── data/questions.ts           30 questions across 3 difficulties
└── utils/                      math helpers, canvas textures
```

### Two state machines, on purpose — but only one system

`GameState` still owns the coarse screen routing (menu, countdown, playing,
results). The battle runs as a `CombatPhase` *underneath* `PLAYING`:

```
ANSWERING → RESOLVING → MONSTER_CHARGING → MONSTER_STRIKING
     ↓
WORD_CONNECT → SPECIAL_ATTACK
```

Keeping the fight in a second field rather than adding members to `GameState`
means every existing screen, input gate, and scene filter kept working as
written, and there is still exactly one publisher feeding the HUD.

### Why it stays at 60 FPS

- One `useFrame` at priority `-1` drives `GameManager.tick(dt)`; everything else
  reads the state it just produced.
- The player's position, the hand's reach, and the indicator that shows them
  are written straight to transforms — moving never re-renders React. Combat wind-ups publish at 12 Hz,
  only while a countdown is actually on screen.
- Block motion is written straight to `Object3D` transforms from a mutable
  `TargetRuntime`. React re-renders the scene only when a new question spawns —
  four components, once every few seconds.
- The HUD subscribes through narrow zustand selectors and is published to only
  on discrete events (question change, punch resolved, each whole second).
- Particles are a fixed 360-instance pool in a single `InstancedMesh`; shockwaves
  and the glove trail are pre-allocated meshes. Nothing is allocated per frame.
- The crosshair writes its own `transform` on `pointermove` rather than holding
  React state.

### Adding a physical punch controller

Everything the game reacts to arrives as a `PunchEvent`:

```ts
{ laneIndex, direction, hand, timestamp, confidence, power, source }
```

Implement `InputSource` and register it — `GameManager` needs no changes:

```ts
inputManager.addSource(new Esp32Source()); // WebSocket / BLE → PunchEvent
```

See `src/game/input/HARDWARE.md` for a worked example including how a motion
controller maps a direction vector onto the 2×2 lane grid.

## Visual design

One cool accent carries the whole interface; colour beyond it is reserved for
meaning — green is correct, red is wrong, amber is a hot streak. All four answer
blocks share the same colour on purpose, so the player reads the letter badge and
the words rather than decoding a rainbow. Every tunable colour lives in
`COLORS` in `src/game/constants.ts` and in the CSS custom properties at the top
of `src/index.css`.

## Audio

Every sound — kick, bass, arp, punch, impact, countdown, game over — is
synthesised at runtime with the Web Audio API. There are no audio files, so
nothing can fail to load. The music uses a lookahead scheduler on the audio
clock, so tempo never drifts with frame rate. Swapping in real samples means
changing `AudioManager` and nothing else.
