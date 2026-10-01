# E-Football

A browser football game in the spirit of FIFA 16: real clubs and players, 11 v 11, on one computer.

- **Modes:** vs CPU, 1 v 1, 2 v 2, and co-op vs CPU (two players on one side).
- **Clubs:** 112 clubs from the Premier League, LaLiga, Serie A, Bundesliga, Ligue 1 and a "Rest of World" set, with 2025-26 squads.
- **Rules:** goals, corners, goal kicks, throw-ins, offside, fouls from tackles and slides, free kicks, penalties, yellow and red cards, half time with ends switched, and added time.
- **Runs light:** about 36 draw calls and 8k triangles a frame, around 10 MB of JavaScript memory. It is built to run in Chrome, Edge or Firefox on an 8 GB laptop with integrated graphics. Pick **Low** quality in Settings on older machines; the game also lowers its resolution by itself if frames drop.

## Play

```bash
npm install
npm run dev        # open the printed http://localhost:5173 link
```

To make a build you can host anywhere (any static file host works):

```bash
npm run build      # output in dist/
npm run preview
```

## Controls

| Action | Keyboard 1 | Keyboard 2 | Gamepad |
| --- | --- | --- | --- |
| Move | W A S D | Arrow keys | Left stick / D-pad |
| Pass (attacking) / Tackle (defending) | J | Num 1 or `,` | A |
| Shoot / Contain | K | Num 2 or `.` | X |
| Through ball | L | Num 3 or `/` | Y |
| Lob, cross / Slide tackle | I | Num 5 or `;` | B |
| Sprint | Left Shift | Num 0 or Right Shift | RT or RB |
| Switch player | Space | Num Enter or Enter | LB |
| Pause | Esc or P | Esc or P | Start |

Hold a kick button longer for more power: the bar above your player shows it. Press a kick button while a pass is on its way to you to hit it first time. Keys can be changed in **Controls**.

2 v 2 needs four devices: two keyboards (the WASD side and the arrow-keys side of one keyboard) and two gamepads, or any mix.

## Squads and ratings

Squads are written for the 2025-26 season. Player ratings are this project's own estimates, not copied from EA or anyone else. Crests are not used; teams are shown by kit colours only.

Transfers happen all the time, so the **Team Editor** lets you change names, positions and ratings for any club, add or remove players, and export your edits as a JSON file to share with friends (they import it on their side).

## Tests

```bash
npm test            # 39 unit tests: rules, timing, fouls, goals, every game mode, balance, data
npm run build && npm run test:e2e   # 42 browser checks in headless Chromium
```

The unit tests drive the match engine directly. They cover kick-off legality; goals, the ball over the bar, corners vs goal kicks, throw-ins and the woodwork; offside (flagged, onside, own half); slide fouls and free-kick spacing; penalties; second yellow giving a red; standing tackles; keeper saves; the clock, added time and the half-time side swap. They also play full matches in every mode with random button mashing and check that the match never stalls and always reaches full time.

The browser checks start each mode from the menus, press real keys (and two simulated gamepads for 2 v 2), and check that every player's controlled footballer moves. They also cover pause, substitutions, half time and full time, and rematch, and confirm there are no page errors. Set `CHROMIUM=/path/to/chrome` if Chromium is not at `/opt/pw-browsers/chromium`.

## Code layout

- `src/sim/` is the match engine: 60 Hz fixed-step physics, rules, and controllers (`match.ts`), ball flight and bounce (`ball.ts`), AI (`ai/`). It has no browser dependencies, so tests run it headless.
- `src/render/` is the Three.js renderer: stadium, procedurally animated players drawn as instanced meshes, broadcast camera.
- `src/data/` holds the clubs and squads (`leagues/*.ts`, one compact line per player) and builds line-ups and player attributes from position and rating.
- `src/ui/` holds the menus, HUD, overlays, team editor and settings. `src/game.ts` runs the game loop, replays and sound.
