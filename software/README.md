# PUNCH ENGLISH

A Beat Saber–style rhythm game for learning English, in the browser. A question
appears, four answer blocks rush in and hold while you read them, then close on
you — punch the right one before it gets past.

It is a **one-handed** game: a single fist throws every punch, reaching toward
whichever answer you commit to.

Not VR — mouse and keyboard — but the input layer is built so a webcam tracker
or an ESP32 motion controller can be dropped in without touching gameplay code.

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
| Mouse click | Punch the block under the cursor. Clicking empty space whiffs. |
| `A` `S` `D` `F` | Punch lane A / B / C / D directly |
| `Space` | Punch whatever you are currently aiming at |
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
breaks the combo. A round is 20 questions or 3:00, whichever comes first.

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
├── game/                     pure TypeScript, no React, no Three.js
│   ├── GameManager.ts        authoritative state + tick(dt) + event bus
│   ├── QuestionManager.ts    serves questions, shuffles answer order
│   ├── ScoreManager.ts       score and session statistics
│   ├── ComboManager.ts       streak and multiplier tiers
│   ├── DifficultyManager.ts  adaptive difficulty + learner signals
│   ├── AudioManager.ts       Web Audio synthesis (music + SFX, no assets)
│   ├── events.ts             typed pub/sub
│   ├── constants.ts          every tunable in one file
│   └── input/
│       ├── PunchEvent.ts     the one contract every input device speaks
│       ├── InputManager.ts   fans InputSources into one punch stream
│       └── HARDWARE.md       how to add an ESP32 / MediaPipe source
│
├── components/
│   ├── scene/                React Three Fiber — reads game state in useFrame
│   ├── hud/                  DOM overlay, repaints only on discrete events
│   └── screens/              menu, how-to-play, settings, countdown, results
│
├── store/gameStore.ts        zustand mirror of the simulation, for the HUD
├── hooks/                    event subscription + narrow selectors
├── data/questions.ts         26 questions across 3 difficulties
└── utils/                    math helpers, answer-card canvas textures
```

### Why it stays at 60 FPS

- One `useFrame` at priority `-1` drives `GameManager.tick(dt)`; everything else
  reads the state it just produced.
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
