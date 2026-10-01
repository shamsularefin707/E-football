# How E-Football Was Built

This document explains how the game was planned and built: the tech stack, the architecture, how each part works, how it was tested, and what is still limited. It is written for anyone who wants to understand the code, change it, or build something similar.

## 1. The goal

The brief was a browser football game with a FIFA 16 feel that:

- runs in a normal browser on an 8 GB RAM laptop with integrated graphics;
- uses current real clubs, players and positions;
- has single player vs CPU, 1 v 1 and 2 v 2 on the same computer (no online play);
- has modest, readable player animation rather than motion-captured realism;
- gets the football right: timing, collisions, fouls, goals and the other rules.

Decisions agreed before any code was written:

| Decision | Choice |
| --- | --- |
| Audience | Private use with friends now; a possible public release later |
| Modes | vs CPU, 1 v 1, 2 v 2, plus co-op vs CPU |
| Engine | Three.js for drawing, TypeScript, Vite, and a custom match engine (no game engine) |
| Data | A swappable data pack; ratings are this project's own estimates, never copied from EA |
| Branding | No real crests; teams are shown by kit colours |
| Feel | FIFA 16-style menus and controls |
| Out of scope | Online play, career mode, commentary |

## 2. Tech stack

| Layer | Technology | Why |
| --- | --- | --- |
| Language | **TypeScript** (strict mode) | Types catch whole classes of bugs in physics and rules code; strict mode also flags unused code |
| Build tool | **Vite** | Fast dev server with hot reload; production build to static files that any host can serve |
| 3D rendering | **Three.js** (r186) | Mature WebGL library, small enough for a browser game, no engine lock-in |
| Audio | **Web Audio API** | All sounds (crowd, whistle, kicks, roar) are synthesised in code, so there are no audio files to download |
| Input | **Keyboard events + Gamepad API** | Two keyboard layouts on one keyboard plus up to four gamepads |
| UI | **Plain DOM + CSS** with a tiny `h()` element helper | Menus don't need a framework; this keeps the bundle small |
| Fonts | Barlow and Barlow Condensed from Google Fonts | Condensed sports-broadcast look for scoreboards and menus |
| Storage | **localStorage** | Settings, key bindings and Team Editor changes, all wrapped in try/catch so a private window still works |
| Unit tests | **Vitest** | Runs the match engine headless in Node |
| Browser tests | **Playwright (playwright-core)** with headless Chromium | Drives the real built game with real key presses |

Runtime dependency: only `three`. Everything else is a dev dependency. The production build is about 706 KB of JavaScript (197 KB gzipped) and 11 KB of CSS.

## 3. Architecture

The most important design rule: **the simulation knows nothing about the browser.** It never touches the DOM, WebGL, audio or timers. That is what makes it possible to test full matches in Node in seconds.

```
            ┌──────────────┐  inputs per controller   ┌──────────────────┐
 keyboard ─►│  InputHub    │ ───────────────────────► │                  │
 gamepads ─►│ (devices.ts) │                          │   Match (sim)    │
            └──────────────┘                          │ 60 Hz fixed step │
                                                      │ physics, rules,  │
            ┌──────────────┐   reads state each frame │ AI, controllers  │
 screen  ◄──│ GameRenderer │ ◄─────────────────────── │                  │
            │  (Three.js)  │                          └────────┬─────────┘
            └──────────────┘                                   │ events
            ┌──────────────┐                                   │ (goal, foul,
 HUD     ◄──│  Hud (DOM)   │ ◄─────────────────────────────────┤  card, kick…)
            └──────────────┘                                   │
            ┌──────────────┐                                   │
 speakers◄──│  Sfx (audio) │ ◄─────────────────────────────────┘
            └──────────────┘
                     ▲
                     └── Game (game.ts) owns the loop, replays and pause
```

Folder layout:

| Folder | What it holds |
| --- | --- |
| `src/sim/` | The match engine: `match.ts` (rules, controllers, restarts, clock), `ball.ts` (ball flight), `kick.ts` (kick maths), `formations.ts`, `ai/brain.ts` (outfield AI), `ai/keeper.ts` (goalkeepers) |
| `src/render/` | `renderer.ts` (scene, stadium, camera), `players.ts` (instanced player meshes and procedural animation), `textures.ts` (pitch, crowd, ad boards, ball, all drawn on canvas) |
| `src/data/` | League files (`leagues/*.ts`), the text-format parser (`pack.ts`), attribute generation (`ratings.ts`), line-up picking and kit clash handling (`lineup.ts`) |
| `src/input/` | Keyboard and gamepad reading, key bindings |
| `src/audio/` | Synthesised sound |
| `src/ui/` | Menus (`screens.ts`), in-match overlays (`overlays.ts`), HUD (`hud.ts`), settings and Team Editor storage (`store.ts`), styles |
| `src/game.ts` | The game loop, replays, pause, event-to-sound wiring |
| `src/main.ts` | App shell that switches between screens and starts matches |
| `tests/unit/` | Vitest tests of the engine |
| `tests/e2e/` | Playwright browser checks |

## 4. The match engine

### 4.1 Fixed time step

The simulation always advances in steps of exactly 1/60 s, no matter how fast the screen refreshes. The game loop collects real elapsed time in an accumulator and runs as many steps as fit (capped at 8 per frame so a hidden tab can't cause a "spiral of death"). Rendering happens once per screen frame from the latest state.

This makes the game behave the same on a 30 fps laptop and a 144 Hz monitor. It also makes it **deterministic**: with the same seed and the same inputs, a match plays out identically, which is what the tests rely on. Randomness comes from a seeded generator (mulberry32), never `Math.random()`.

### 4.2 Coordinates and the pitch

- The pitch is 105 × 68 m with the origin on the centre spot.
- The sim uses x along the pitch, y across it, and z for height. Three.js uses y for height, so the renderer maps sim `(x, y, z)` to Three.js `(x, z, −y)`.
- The camera sits on the −y touchline, so pushing the stick right means +x and up means +y, like a TV broadcast.
- Team 0 attacks +x in the first half; directions flip at half time.
- Real dimensions are used throughout: 7.32 m goals, 2.44 m crossbar, 16.5 m penalty area, 11 m penalty spot, 9.15 m centre circle and wall distance.

### 4.3 Ball physics (`ball.ts`, `kick.ts`)

- **In the air:** gravity (9.81 m/s²), air drag, and spin that curls the ball sideways and decays over time.
- **Bounces:** 55% restitution; below a small downward speed the ball stops bouncing and rolls.
- **Rolling:** a constant grass resistance plus a speed-proportional drag. This has a closed-form solution, so `kick.ts` can work backwards: for a pass of distance *d* that should arrive at speed *v*, it computes the exact kick speed needed. The same maths gives the time a rolling ball takes to arrive, which the AI uses for interceptions.
- **Lobs and crosses:** the loft is solved so the ball lands at the target point after a chosen flight time.
- **Posts and crossbar:** the ball is moved in small sub-steps near the goal so a fast shot can't pass through a 12 cm post between two frames. Hitting the woodwork bounces the ball off and raises an event.
- **The net:** after a goal, the ball is kept inside the net's volume.

### 4.4 Players and collisions

- Each player has position, velocity, facing direction, stamina, an action (tackle, slide, stumble, dive, kick, celebrate, throw) with a timer, cards, and the controller currently driving them, if any.
- Speed comes from the pace attribute (jog about 4.6 to 6.6 m/s, sprint about 6 to 9.7 m/s). Sprinting drains stamina, which recovers slowly and also affects speed.
- Players are 0.4 m circles. After movement, overlapping players are pushed apart so nobody walks through anyone else.
- A player can take a free ball within 0.75 m horizontally and below 1 m height; higher balls up to 2.5 m can be headed. After kicking, a player can't touch the ball again for 0.3 s.

### 4.5 Rules

| Rule | How it works |
| --- | --- |
| **Goals** | When the ball crosses the goal line in a frame, the engine interpolates the exact crossing point and checks it was between the posts and under the bar. Own goals are credited correctly. |
| **Out of play** | The last player to touch the ball decides the restart: throw-in on the touchline; over the goal line it is a goal kick or a corner depending on which team touched it last. |
| **Offside** | Judged at the moment of the pass, not when the ball arrives. The engine records which attackers were offside when the ball was kicked; if one of them then plays it, an indirect free kick is given. No offside from throw-ins, corners or goal kicks, or in your own half. |
| **Fouls** | Standing tackles and slide tackles resolve after a short wind-up. Winning the ball cleanly is fine; arriving late or from behind is a foul. The chance depends on angle, timing and the defender's defending rating. |
| **Free kicks** | Opponents are moved 9.15 m from the ball. |
| **Penalties** | A foul by a defender in their own penalty area gives a penalty. Everyone except the taker and keeper is moved outside the area. The keeper picks a side to dive. |
| **Cards** | Slide tackles and fouls from behind can bring a yellow; a slide from behind can occasionally be a straight red. A second yellow is a red and the player is sent off. Keepers are never sent off. |
| **Clock** | 45 game minutes per half, scaled to the real half length you choose (2 to 10 minutes). Added time of 1 to 5 minutes is based on stoppages. The clock stops during goal celebrations and before kick-off. A penalty awarded at the end of a half is always taken before the whistle. |
| **Half time** | Teams swap ends and the other team kicks off. |
| **Substitutions** | Up to 5 per team. Keepers can only replace keepers. |

All of these happen inside `Match.step()`, which runs in a fixed order every tick: read controllers, run AI, move players, resolve tackles, move the ball, check the lines, then run the clock.

### 4.6 Human controls (`ControllerRT` in `match.ts`)

- **Charged kicks:** hold a kick button to build power (full at 0.9 s), release to kick. The HUD shows a power bar above your player.
- **First-time actions:** press a kick button while a pass is on its way and the action is queued until you receive it.
- **Context buttons:** the same buttons that pass and lob when attacking become tackle and slide when defending. Holding shoot when defending makes your player jockey (contain) instead of diving in.
- **Player switching:** manual switch picks the best-placed team-mate (never the keeper, never a player your partner controls). Control also switches automatically to the receiver of your pass and to a team-mate who wins the ball, and when your player is far from play.
- **Receive assist:** a light pull towards an incoming pass so controlled players don't run past it.
- **Idle protection:** if a human doesn't take a restart within 20 seconds, the AI takes it, so a match can never stall.

### 4.7 AI (`ai/brain.ts`, `ai/keeper.ts`)

- **Team shape:** each formation is a set of slots with a depth and a side. The whole shape shifts with the ball: it pushes up and narrows in attack and drops back and compacts in defence.
- **Without the ball:** the nearest one or two players press, others mark opponents in their zone, and the rest hold shape. The best interceptor is chosen using the ball prediction (where the free ball will be every 0.1 s ahead).
- **With the ball:** the carrier scores every option (shot, short pass, through ball, lob, cross, dribble, clearance) on things like distance to goal, angle, passing-lane risk and pressure, then picks the best. Passing-lane risk is time-based: it asks whether any defender can reach the lane before the ball does.
- **Support runs:** team-mates make runs into space but stop at the offside line.
- **Difficulty:** Amateur, Professional and World Class change reaction time, decision noise and how often the AI tackles or slides. AI team-mates of human players always play at Professional.
- **Goalkeepers:** position on the line between ball and goal centre, come out for through balls, dive towards shots, and make a save check based on their diving, reflexes and handling. A save is either caught (held for 1.2 s, then distributed) or parried; some parries go wide for a corner.

## 5. Rendering (`src/render/`)

The goal was a clean broadcast look that a laptop GPU can draw at 60 fps.

- **Players:** 22 players are drawn as 14 instanced body-part meshes (head, torso, upper and lower arms and legs, and so on), so all players together take about 14 draw calls. A simple skeleton is posed every frame in code: run cycle based on speed, kicking, throw-ins, tackles, slides, stumbles, keeper stance, dives and goal celebrations. Kit, skin and hair colours are set per instance.
- **Textures are drawn in code** on canvases: striped pitch with all line markings, crowd, LED ad boards and the ball. No image files are loaded.
- **Shadows:** cheap blob shadows under players and the ball instead of real-time shadow maps.
- **Stadium:** stands, ad boards, goals with net lines, corner flags, and floodlights for night matches.
- **Cameras:** Broadcast, Tele (close) and Wide, all smoothly following the ball. Small camera shake on goals and woodwork.
- **Quality levels:** Low, Medium and High change antialiasing and the maximum pixel ratio. "Auto" reads the GPU name through `WEBGL_debug_renderer_info`: software renderers get Low, integrated Intel or AMD chips get Medium, others High. Low device memory also forces Low.
- **Adaptive resolution:** every 90 frames the renderer checks the average frame time; if frames are slower than 45 fps it lowers the render resolution, and raises it again when there's headroom.

Measured cost per frame: about **36 draw calls, 8,300 triangles, 5 textures, and around 10 MB of JavaScript memory.**

## 6. Clubs and players (`src/data/`)

- **Coverage:** 112 clubs: Premier League (20), LaLiga (20), Serie A (20), Bundesliga (18), Ligue 1 (18) and a Rest of World set (16, including Benfica, Porto, Sporting, Ajax, PSV, Feyenoord, Celtic, Rangers, Galatasaray, Fenerbahce, Al Nassr, Al Hilal, Inter Miami, Boca Juniors, River Plate and Flamengo).
- **Season:** 2025-26 squads.
- **Compact text format:** each club is one header line plus players written as `POS Name RATING;`:

  ```
  # liv | Liverpool | LIV | #c8102e,#c8102e,#c8102e | #f5f5f5,#f5f5f5,#f5f5f5 | 4-2-3-1
  GK Alisson Becker 88; GK Giorgi Mamardashvili 80; CB Virgil van Dijk 88; ...
  ```

  `pack.ts` parses this and rejects bad entries, so a typo fails loudly instead of silently dropping a player.
- **Attributes:** each player has 12 attributes (pace, acceleration, shooting, passing, dribbling, defending, physical, stamina and four goalkeeping ones). They are generated from the position and overall rating using position profiles, plus a small stable variation from a hash of the name, so the same player always gets the same numbers.
- **Line-ups:** `pickLineup` fills each formation slot with the best-fitting player using a position-fit score (a left back fits LWB well, a CM fits CDM fairly well, and so on).
- **Kit clashes:** if the two shirts are too similar in colour, the away team switches to its away kit, and if that still clashes, to a neutral kit. Keepers get kits that clash with neither team.
- **Team Editor:** players can be renamed, moved, re-rated, added or removed per club. Changes are stored as overrides on top of the built-in data and can be exported and imported as JSON.

**How the squad data was made:** the plan was to pull squads from Wikidata, but that service was blocked from the build environment. The squads were therefore written from knowledge of the 2025-26 season. Transfers after that are likely missing; the Team Editor exists so this can be corrected without touching code.

## 7. Menus, HUD and game flow (`src/ui/`, `src/game.ts`)

- **Main menu:** Kick Off, Team Editor, Controls, Settings.
- **Kick Off screen:** mode tabs, home and away team cards (league, club, star rating, OVR/ATT/MID/DEF, kit, formation), a device picker per player that blocks the same device being picked twice and warns about missing gamepads, and match settings (half length, difficulty, day or night, camera).
- **HUD:** scoreboard with clock and added time, banners for goals (scorer and minute, including "45+2'"), fouls, penalties, cards, offsides, corners, saves and the woodwork, name tags with power bars above controlled players, a radar, a controls reminder and an optional FPS counter.
- **Pause menu:** resume, team management (formation, swapping positions, substitutions with stamina shown), match stats, controls, camera and sound, restart and quit.
- **Half time and full time:** score, scorers and a full stats comparison (possession, shots, shots on target, passes, pass accuracy, fouls, cards, corners, offsides). Full time offers Rematch or Main menu.
- **Goal replays:** the game records a snapshot of every player and the ball 30 times a second, keeping the last 8 seconds. After a goal it plays back the build-up in slight slow motion; any key skips it. During the replay the live state is saved and restored afterwards, so the match is not affected.
- **Sound:** a crowd bed that swells as the ball nears a goal, whistles for stoppages, kick sounds scaled by power, a roar for goals and a groan for near misses.

## 8. Testing and verification

### 8.1 Unit tests: 39 tests with Vitest (`npm test`)

| File | What it proves |
| --- | --- |
| `rules.test.ts` (17) | Kick-off legality; goals; ball over the bar; goal kick vs corner by last touch; throw-ins; woodwork; offside flagged, onside, and not in your own half; slide fouls giving free kicks with 9.15 m spacing; penalties with players cleared from the area; second yellow giving a red; standing tackles; keeper saves; the clock, added time, half time and the side swap; the clock pausing for goals; penalty area geometry |
| `modes.test.ts` (15) | For each mode (vs CPU, 1 v 1, 2 v 2, co-op): controllers are assigned correctly, and a full match with random button mashing never breaks an invariant and never sits in one phase for more than 22 s. Also: movement and sprint, a charged pass handing control to the receiver, scoring into an empty goal, tackle and slide buttons, switching never picking the keeper or a partner's player, the kick-off not being rushed, and 1 v 1 players never controlling the other team |
| `balance.test.ts` (2) | CPU vs CPU matches produce believable numbers (shots, goals, pass completion over 55%), and a stronger team beats a weaker one over many matches |
| `data.test.ts` (5) | League and club counts, a legal XI for every club, no player duplicated across clubs, ratings in range, and a real-club match reaching full time |

Tuned CPU vs CPU averages per match: about 12.7 shots, 3.5 goals, 68% pass completion, 5.7 fouls and 2.2 cards.

### 8.2 Browser checks: 42 checks with Playwright (`npm run build && npm run test:e2e`)

The script serves the production build, opens it in headless Chromium, and:

- checks every menu screen renders and that picking the same device twice disables Play;
- starts **vs CPU**, **1 v 1**, **2 v 2** and **co-op** from the menus;
- presses real keys and checks every controlled player moves (in 2 v 2, two keyboard layouts plus two simulated gamepads);
- checks P1 and P2 never control the same player, and in 2 v 2 that four different players are controlled;
- checks the clock runs in real time, Escape pauses and freezes the clock, a substitution works, and Resume continues;
- plays through half time (clicking "Second half") to full time, checks the final clock is at least 90:00, then tests Rematch and Quit;
- fails on any JavaScript error on the page;
- saves screenshots to `tests/e2e/out/`.

### 8.3 Performance check

Measured in headless Chromium with software rendering (SwiftShader, no GPU): 36 draw calls, about 8.3k triangles, around 10 MB of JS heap, 10 to 14 fps. The low frame rate is the software renderer; the workload is small enough for an integrated laptop GPU to run at 60 fps, but that has not yet been confirmed on real hardware.

## 9. How the work was done

1. **Brainstorm and design.** Agreed on the audience, modes, stack, data approach and scope, then reviewed the design section by section: engine, AI and controls, visuals and performance and data, menus and milestones.
2. **Engine first, tests alongside.** Built the simulation (ball, rules, controllers, AI) as plain TypeScript with no browser code, writing unit tests for each rule as it was added.
3. **Balance pass.** Ran many CPU vs CPU matches and tuned AI and physics until the numbers looked like football.
4. **Data.** Wrote the compact league format and the 112 clubs, plus attribute generation and line-up selection, with tests for duplicates and legal XIs.
5. **Rendering and audio.** Built the Three.js stadium, instanced players with code-driven animation, canvas textures, cameras and synthesised sound.
6. **UI and game loop.** Menus, HUD, overlays, Team Editor, settings, replays and pause.
7. **Verification.** Ran the unit tests, then the browser checks against the production build, fixed what they found, and measured performance.
8. **Ship.** Pushed to GitHub and published a single-file playable build.

## 10. Known limitations

- **Squads may be out of date:** see section 6. Use the Team Editor.
- **Real-GPU frame rate not measured yet:** only software rendering was available for testing.
- **Gamepads in menus:** the pause menu and other menus need a mouse or keyboard; gamepads work in matches and for pausing.
- **Team Editor export** does not work in the claude.ai playable link (the page sandbox blocks downloads). It works when you run the game from the repo.
- **Not included:** online play, career mode, commentary, real crests.

## 11. Run it

```bash
npm install
npm run dev                          # play at http://localhost:5173
npm test                             # unit tests
npm run build && npm run test:e2e    # browser checks
```
