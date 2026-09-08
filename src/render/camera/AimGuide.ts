import * as THREE from "three";
import type { ShipState } from "../../core/contracts";
import { sampleCannonTrajectory } from "../../simulation/ballistics";
import type { AimState } from "../../input/controls";
import { getShipSpec } from "../../content/shipSpecs";
import { areFactionsHostile } from "../../simulation/factions";

/** Choose in the selected firing hemisphere before considering distance or an opening. */
export function selectAimTarget(
  player: ShipState,
  ships: readonly ShipState[],
  aim: Readonly<AimState>,
  preferredId?: string,
): ShipState | undefined {
  const hostiles = ships.filter(
    (candidate) =>
      candidate.id !== player.id &&
      !candidate.surrendered &&
      candidate.damage.hull < 1 &&
      candidate.finish?.state !== "sinking" &&
      candidate.finish?.state !== "sunk" &&
      areFactionsHostile(
        player.faction ?? "straw-hat",
        candidate.faction ?? "marine",
      ),
  );
  if (!aim.side)
    return (
      hostiles.find((candidate) => candidate.id === preferredId) ??
      hostiles.reduce<ShipState | undefined>(
        (nearest, candidate) =>
          !nearest ||
          Math.hypot(
            candidate.position.x - player.position.x,
            candidate.position.z - player.position.z,
          ) <
            Math.hypot(
              nearest.position.x - player.position.x,
              nearest.position.z - player.position.z,
            )
            ? candidate
            : nearest,
        undefined,
      )
    );
  const sign = aim.side === "port" ? -1 : 1;
  const lateral = (target: ShipState) =>
    ((target.position.x - player.position.x) * Math.cos(player.heading) -
      (target.position.z - player.position.z) * Math.sin(player.heading)) *
    sign;
  const firingSide = hostiles.filter((target) => lateral(target) > 0);
  const candidates = firingSide.length ? firingSide : hostiles;
  const shot = sampleCannonTrajectory(player, aim.side, aim.adjustment);
  const bearing = Math.atan2(shot.velocity.x, shot.velocity.z);
  const score = (target: ShipState) => {
    const dx = target.position.x - shot.position.x,
      dz = target.position.z - shot.position.z;
    const difference = Math.atan2(
      Math.sin(Math.atan2(dx, dz) - bearing),
      Math.cos(Math.atan2(dx, dz) - bearing),
    );
    return (
      Math.abs(difference) * 300 +
      Math.hypot(dx, dz) * 0.35 -
      (target.id === preferredId ? 15 : 0)
    );
  };
  return candidates.reduce<ShipState | undefined>(
    (best, candidate) =>
      !best || score(candidate) < score(best) ? candidate : best,
    undefined,
  );
}

export function aimTargetSolution(
  player: ShipState,
  aim: Readonly<AimState>,
  target?: ShipState,
) {
  const side = aim.side ?? "starboard";
  const shot = sampleCannonTrajectory(player, side, aim.adjustment);
  const range = Math.hypot(
    shot.impact.x - shot.position.x,
    shot.impact.z - shot.position.z,
  );
  const speed = Math.hypot(shot.velocity.x, shot.velocity.z);
  const dirX = shot.velocity.x / speed,
    dirZ = shot.velocity.z / speed;
  let guidance = "FIND A TARGET OFF THIS SIDE";
  let inLane = false,
    correctSide = false,
    distance = 0,
    timeToTarget = 0;
  let predicted = target ? { ...target.position } : undefined;
  if (target) {
    distance = Math.hypot(
      target.position.x - player.position.x,
      target.position.z - player.position.z,
    );
    const targetVx = -Math.sin(target.heading) * target.speed,
      targetVz = -Math.cos(target.heading) * target.speed;
    const initialX = target.position.x - shot.position.x,
      initialZ = target.position.z - shot.position.z;
    const relativeVx = shot.velocity.x - targetVx,
      relativeVz = shot.velocity.z - targetVz;
    timeToTarget = Math.max(
      0,
      Math.min(
        shot.flightTime,
        (initialX * relativeVx + initialZ * relativeVz) /
          Math.max(1, relativeVx ** 2 + relativeVz ** 2),
      ),
    );
    predicted = {
      x: target.position.x + targetVx * timeToTarget,
      y: target.position.y,
      z: target.position.z + targetVz * timeToTarget,
    };
    const dx = predicted.x - shot.position.x,
      dz = predicted.z - shot.position.z;
    const sideSign = side === "port" ? -1 : 1;
    const sideDistance =
      (dx * Math.cos(player.heading) - dz * Math.sin(player.heading)) *
      sideSign;
    correctSide = sideDistance > 0;
    const forwardDistance =
      dx * -Math.sin(player.heading) + dz * -Math.cos(player.heading);
    const currentBearing = Math.atan2(
      shot.velocity.x * -Math.sin(player.heading) +
        shot.velocity.z * -Math.cos(player.heading),
      (shot.velocity.x * Math.cos(player.heading) -
        shot.velocity.z * Math.sin(player.heading)) *
        sideSign,
    );
    const desiredBearing = Math.atan2(forwardDistance, sideDistance);
    const error = desiredBearing - currentBearing;
    const spec = getShipSpec(target.kind);
    const projectedHalfWidth =
      Math.abs(
        dirZ * -Math.sin(target.heading) - dirX * -Math.cos(target.heading),
      ) *
        spec.length *
        0.5 +
      Math.abs(
        dirZ * Math.cos(target.heading) - dirX * -Math.sin(target.heading),
      ) *
        spec.beam *
        0.5;
    const along = dx * dirX + dz * dirZ;
    const cross = Math.abs(dx * dirZ - dz * dirX);
    const volleyWidth =
      getShipSpec(player.kind).length * 0.22 + Math.max(0, along) * 0.055;
    inLane =
      correctSide &&
      along > 0 &&
      along <= range + spec.length * 0.35 &&
      cross <= projectedHalfWidth + volleyWidth;
    if (!correctSide)
      guidance =
        side === "port" ? "AIM STARBOARD · HOLD V" : "AIM PORT · HOLD Z";
    else if (along > range + spec.length * 0.35)
      guidance = `CLOSE ≈${Math.round(along - range)} m`;
    else if (Math.abs(desiredBearing) > 0.38)
      guidance = "TURN TO BRING YOUR BROADSIDE TO BEAR";
    else if (!inLane || Math.abs(error) > 0.055)
      guidance =
        error > 0 ? ". LEAD TOWARD THE BOW" : ", LEAD TOWARD THE STERN";
    else guidance = "TARGET CROSSES THE SHOT LANE";
  }
  return {
    shot,
    range,
    distance,
    timeToTarget,
    predicted,
    correctSide,
    inLane,
    guidance,
  };
}

/** A water-plane firing envelope derived from the same muzzle speed, gravity and spread as simulation. */
export class AimGuide {
  readonly root = new THREE.Group();
  private readonly positions = new Float32Array(256 * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({
    color: 0xffe5a0,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly lines: THREE.LineSegments;
  private readonly targetMarker = new THREE.Group();
  private readonly locator?: HTMLDivElement;
  private readonly projected = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraToTarget = new THREE.Vector3();
  private readonly markerGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0.72, 0),
    new THREE.Vector3(0, 0.72, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, -0.72, 0),
    new THREE.Vector3(0, -0.72, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, -0.85, 0),
    new THREE.Vector3(0, -1.6, 0),
  ]);
  private readonly markerMaterial = new THREE.LineBasicMaterial({
    color: 0xffe5a0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  constructor(scene: THREE.Scene, private readonly container?: HTMLElement) {
    if(container){
      this.locator=document.createElement('div');
      this.locator.dataset.aimTargetLocator='';
      this.locator.setAttribute('aria-hidden','true');
      this.locator.style.cssText='position:absolute;z-index:12;pointer-events:none;transform:translate(-50%,-50%);background:#052b40ed;border:1px solid #ffe3a0;border-radius:4px;padding:5px 8px;color:#fff1bf;font:700 11px/1.3 system-ui;text-align:center;box-shadow:0 2px 8px #00162680;white-space:nowrap;display:none';
      container.append(this.locator);
    }
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.root.add(this.lines);
    const brackets = new THREE.LineSegments(
      this.markerGeometry,
      this.markerMaterial,
    );
    brackets.renderOrder = 15;
    this.targetMarker.add(brackets);
    this.targetMarker.name = "selected-hostile-world-marker";
    this.root.add(this.targetMarker);
    this.root.name = "authoritative-broadside-envelope";
    scene.add(this.root);
  }
  update(
    ship: ShipState,
    aim: Readonly<AimState>,
    target?: ShipState,
    camera?: THREE.PerspectiveCamera,
    time=0,
    seaHeight?:(x:number,z:number,time:number)=>number,
  ): void {
    this.root.visible = Boolean(aim.side);
    if(this.locator)this.locator.style.display=aim.side&&target?'block':'none';
    if (!aim.side) return;
    const solution = aimTargetSolution(ship, aim, target);
    const center = solution.shot;
    this.targetMarker.visible = Boolean(target);
    this.root.userData.targetId = target?.id;
    this.root.userData.impact = { ...center.impact };
    if (target) {
      const targetSpec = getShipSpec(target.kind);
      this.targetMarker.position.set(
        target.position.x,
        target.position.y + targetSpec.draft * 0.61 + 9.5,
        target.position.z,
      );
      this.targetMarker.userData.targetId = target.id;
      if(this.locator && camera && this.container){
        camera.updateMatrixWorld();
        this.projected.copy(this.targetMarker.position).project(camera);
        this.cameraToTarget.copy(this.targetMarker.position).sub(camera.position);
        camera.getWorldDirection(this.cameraForward);
        const behind=this.cameraToTarget.dot(this.cameraForward)<0;
        const width=this.container.clientWidth,height=this.container.clientHeight;
        let nx=this.projected.x,ny=this.projected.y;
        if(behind){nx=-nx;ny=-ny;}
        const rawX=(nx*.5+.5)*width,rawY=(-.5*ny+.5)*height;
        const portrait=width<600&&height>width;
        const minY=portrait?height*.32:height*.23,maxY=portrait?height*.345:height*.58;
        const x=THREE.MathUtils.clamp(rawX,66,width-66);
        const y=THREE.MathUtils.clamp(rawY,minY,maxY);
        const horizontal=behind||rawX<66||rawX>width-66;
        const offscreen=horizontal||rawY<minY||rawY>maxY;
        const arrow=offscreen?(horizontal?(nx<0?'←':'→'):(rawY<minY?'↑':'↓')):'◇';
        this.locator.textContent=`${arrow} TARGET · ${Math.round(solution.distance)} m`;
        this.locator.style.left=`${x}px`;this.locator.style.top=`${y}px`;
        this.locator.dataset.targetId=target.id;
        this.locator.dataset.offscreen=String(offscreen);
        this.root.userData.targetLocator={targetId:target.id,x,y,offscreen};
      }else this.root.userData.targetLocator=undefined;
      this.markerMaterial.color.setHex(
        solution.correctSide ? 0xffe5a0 : 0xffac73,
      );
      if (camera) {
        this.targetMarker.quaternion.copy(camera.quaternion);
        const distance = camera.position.distanceTo(this.targetMarker.position);
        const pixels = 14;
        const height = typeof window === "undefined" ? 900 : window.innerHeight;
        this.targetMarker.scale.setScalar(
          Math.max(
            0.8,
            Math.min(
              12,
              (distance *
                2 *
                Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) *
                pixels) /
                height,
            ),
          ),
        );
      }
    }
    const edges = [-0.5, 0.5].map((offset) =>
      sampleCannonTrajectory(ship, aim.side!, aim.adjustment, offset),
    );
    let count = 0;
    const vertex = (x: number, z: number) => {
      this.positions[count++] = x;
      this.positions[count++] = seaHeight ? seaHeight(x,z,time)+.4 : 1.25;
      this.positions[count++] = z;
    };
    for (const edge of edges) {
      vertex(edge.position.x, edge.position.z);
      vertex(edge.impact.x, edge.impact.z);
    }
    for (let segment = 0; segment < 12; segment++) {
      const a = segment / 12,
        b = (segment + 1) / 12;
      vertex(
        THREE.MathUtils.lerp(edges[0].impact.x, edges[1].impact.x, a),
        THREE.MathUtils.lerp(edges[0].impact.z, edges[1].impact.z, a),
      );
      vertex(
        THREE.MathUtils.lerp(edges[0].impact.x, edges[1].impact.x, b),
        THREE.MathUtils.lerp(edges[0].impact.z, edges[1].impact.z, b),
      );
    }
    const range = Math.hypot(
      center.impact.x - center.position.x,
      center.impact.z - center.position.z,
    );
    const dx = (center.impact.x - center.position.x) / range,
      dz = (center.impact.z - center.position.z) / range;
    // Water impact ring and a broken ballistic arc distinguish the landing estimate from the target marker.
    for (let segment = 0; segment < 16; segment++) {
      const a = (segment / 16) * Math.PI * 2,
        b = ((segment + 1) / 16) * Math.PI * 2;
      vertex(
        center.impact.x + Math.cos(a) * 4.5,
        center.impact.z + Math.sin(a) * 4.5,
      );
      vertex(
        center.impact.x + Math.cos(b) * 4.5,
        center.impact.z + Math.sin(b) * 4.5,
      );
    }
    for (let segment = 0; segment < 16; segment += 2) {
      for (const step of [segment, segment + 1]) {
        const t = (center.flightTime * step) / 16;
        this.positions[count++] = center.position.x + center.velocity.x * t;
        this.positions[count++] =
          center.position.y +
          center.velocity.y * t -
          center.gravity * t * t * 0.5;
        this.positions[count++] = center.position.z + center.velocity.z * t;
      }
    }
    for (let d = 25; d < range; d += 25) {
      const x = center.position.x + dx * d,
        z = center.position.z + dz * d;
      vertex(x - dz * 2, z + dx * 2);
      vertex(x + dz * 2, z - dx * 2);
    }
    this.geometry.setDrawRange(0, count / 3);
    this.geometry.attributes.position.needsUpdate = true;
  }
  dispose(): void {
    this.locator?.remove();
    this.root.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.markerGeometry.dispose();
    this.markerMaterial.dispose();
  }
}
