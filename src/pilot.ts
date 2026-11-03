import * as THREE from 'three';

/**
 * The Home screen's AI pilot, reduced to what shows on screen: the steering law of the game's
 * AIPilot.cs feeding a VesselTransformer with the Squirrel's numbers (Squirrel.prefab).
 *
 *  - Stick: localCross = hull⁻¹ (forward × toTarget); angle = asin(clamp(|c|² · 100 / min(d², 50))) in
 *    degrees; yaw = clamp(angle · c.y), pitch = clamp(angle · c.x); a target behind the nose turns hard
 *    (TurnHardIfBehind). In practice that is full stick until the nose is within a hair of the target.
 *  - Command: the stick turns the commanded rotation at PitchScaler / YawScaler = 120 °/s about the
 *    hull's own axes (RotationThrottleScaler 0, so the rate does not grow with speed).
 *  - Hull: slerps toward the command at LERP_AMOUNT = 1.5 per second. AI pilots keep this fleet lag
 *    (VesselTransformer.NoseFollowFraction), and it is what gives the AI its wide, overshooting loops.
 *  - Speed: eases toward throttle × ThrottleScaler = 0.6 × 60 = 36 u/s at the same 1.5 per second
 *    (defaultThrottle 0.6, DefaultMinimumSpeed 0).
 *
 * The pilot's frame has +z forward and +y up. The game's continuous roll input is replaced with a
 * bounded bank into the turn, applied to the model only, so the flight path is the game's and the
 * hull reads as an aircraft (the plan's §5).
 */
const TURN_DEG_PER_S = 120;
const FOLLOW_PER_S = 1.5;
const CRUISE_SPEED = 0.6 * 60;
const MAX_DISTANCE = 50; // AIPilot._maxDistance, compared against the SQUARED distance (as in the game)
const BANK_MAX = THREE.MathUtils.degToRad(38);
const BANK_PER_S = 2.5;
const MAX_STEP = 1 / 60;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class Pilot {
  /** Where the vessel is and how its hull points; the trail reads this. */
  readonly object = new THREE.Group();
  /** The bank lives here so the trail lays along the flight path, not the banked wings. */
  readonly bankFrame = new THREE.Group();
  speed = CRUISE_SPEED * 0.5;
  /** Yaw stick this frame, -1..1 (for anything that wants to read the turn). */
  yawStick = 0;

  private readonly command = new THREE.Quaternion();
  private bank = 0;

  // scratch
  private readonly fwd = new THREE.Vector3();
  private readonly toT = new THREE.Vector3();
  private readonly cross = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly inv = new THREE.Quaternion();
  private readonly dq = new THREE.Quaternion();

  constructor(model: THREE.Object3D, start: THREE.Vector3, lookAt: THREE.Vector3) {
    this.object.add(this.bankFrame);
    this.bankFrame.add(model);
    this.object.position.copy(start);
    this.object.lookAt(lookAt); // a non-camera Object3D points +z at the target
    this.command.copy(this.object.quaternion);
    this.object.name = 'Pilot';
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  get forward(): THREE.Vector3 {
    return this.fwd.copy(Z).applyQuaternion(this.object.quaternion);
  }

  update(dt: number, target: THREE.Vector3): void {
    let left = Math.min(dt, 0.25); // a long stall (tab hidden) does not fling the vessel
    while (left > 1e-6) {
      const h = Math.min(MAX_STEP, left);
      this.step(h, target);
      left -= h;
    }
  }

  private step(dt: number, target: THREE.Vector3): void {
    const hull = this.object.quaternion;
    const fwd = this.fwd.copy(Z).applyQuaternion(hull);
    this.toT.subVectors(target, this.object.position);
    const sqr = this.toT.lengthSq();

    let yaw = 0;
    let pitch = 0;
    if (sqr > 1e-6) {
      const dir = this.toT.multiplyScalar(1 / Math.sqrt(sqr));
      this.inv.copy(hull).invert();
      const c = this.cross.crossVectors(fwd, dir).applyQuaternion(this.inv);
      let angle = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((c.lengthSq() * 100) / Math.min(sqr, MAX_DISTANCE), -1, 1)));
      if (fwd.dot(dir) < 0) {
        if (c.lengthSq() > 1e-8) c.normalize();
        else c.copy(Y);
        angle = 90;
      }
      yaw = THREE.MathUtils.clamp(angle * c.y, -1, 1);
      pitch = THREE.MathUtils.clamp(angle * c.x, -1, 1);
    }
    this.yawStick = yaw;

    // Turn the command about the hull's own axes (as Pitch()/Yaw() do with transform.right / up).
    const rate = THREE.MathUtils.degToRad(TURN_DEG_PER_S) * dt;
    this.dq.setFromAxisAngle(this.axis.copy(X).applyQuaternion(hull), pitch * rate);
    this.command.premultiply(this.dq);
    this.dq.setFromAxisAngle(this.axis.copy(Y).applyQuaternion(hull), yaw * rate);
    this.command.premultiply(this.dq);
    this.command.normalize();

    // The hull follows the command with the fleet lag.
    hull.slerp(this.command, Math.min(1, FOLLOW_PER_S * dt));

    // Speed eases toward cruise; the vessel moves along its nose.
    this.speed += (CRUISE_SPEED - this.speed) * Math.min(1, FOLLOW_PER_S * dt);
    this.object.position.addScaledVector(this.fwd.copy(Z).applyQuaternion(hull), this.speed * dt);

    // Bank into the turn: a positive yaw turns +z toward +x, so lean +y toward +x (negative roll about +z).
    const bankTarget = -yaw * BANK_MAX;
    this.bank += (bankTarget - this.bank) * Math.min(1, BANK_PER_S * dt);
    this.bankFrame.quaternion.setFromAxisAngle(Z, this.bank);
  }
}
