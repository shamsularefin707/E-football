// All distances in metres, times in seconds, speeds in m/s.
// Pitch origin is the centre spot. x runs along the length (goal to goal),
// y across the width, z is height above the grass.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const PITCH_HALF_LENGTH = 52.5;
export const PITCH_HALF_WIDTH = 34;
export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;
export const GOAL_DEPTH = 2.2;
export const POST_RADIUS = 0.06;
export const PENALTY_AREA_DEPTH = 16.5;
export const PENALTY_AREA_HALF_WIDTH = 20.16;
export const GOAL_AREA_DEPTH = 5.5;
export const GOAL_AREA_HALF_WIDTH = 9.16;
export const PENALTY_SPOT_DIST = 11;
export const CENTRE_CIRCLE_RADIUS = 9.15;
export const SET_PIECE_DISTANCE = 9.15;

export const BALL_RADIUS = 0.11;
export const GRAVITY = 9.81;
export const AIR_DRAG = 0.12; // fraction of speed lost per second in the air
export const ROLL_DECEL = 2.6; // m/s^2 rolling resistance on grass
export const ROLL_DRAG = 0.25; // extra proportional slow-down while rolling
export const BOUNCE_RESTITUTION = 0.55;
export const BOUNCE_MIN_VZ = 1.2; // below this downward speed the ball stops bouncing
export const CURL_FORCE = 2.2; // lateral accel per unit of spin
export const SPIN_DECAY = 0.6; // per second

export const PLAYER_RADIUS = 0.4;
export const CONTROL_RADIUS = 0.75; // horizontal distance at which a player can take the ball
export const CONTROL_MAX_HEIGHT = 1.0;
export const HEADER_MAX_HEIGHT = 2.5;
export const KICK_COOLDOWN = 0.3; // after kicking, the kicker can't retouch for this long

export const STAMINA_SPRINT_DRAIN = 0.012; // per second while sprinting (0..1 scale)
export const STAMINA_RECOVER = 0.004;

export const GK_HOLD_TIME = 1.2;
export const GOAL_CELEBRATION_TIME = 4;
export const RESTART_DELAY = 1.2;
export const HALF_TIME_PAUSE = 3;

/** Real-time half lengths the player can pick, in minutes. */
export const HALF_LENGTH_OPTIONS = [2, 4, 6, 10] as const;
