import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ShipGeometryFactory } from '../src/render/ships/ShipGeometryFactory';
import { SketchfabShipAssets } from '../src/render/loaders/SketchfabShipAssets';
import { SketchfabCrewAssets, sourceDeckContact } from '../src/render/loaders/SketchfabCrewAssets';
import { SKETCHFAB_SHIPS, hasSketchfabShip } from '../src/content/sketchfabShips';
import { SCENARIO_PRESETS } from '../src/content/scenarios';
import { GameSimulation } from '../src/simulation/GameSimulation';
import { sampleCannonTrajectory } from '../src/simulation/ballistics';
import type { ShipKind } from '../src/core/contracts';

beforeEach(()=>{
  vi.spyOn(SketchfabShipAssets.prototype,'mount').mockResolvedValue(undefined);
  vi.spyOn(SketchfabCrewAssets.prototype,'mount').mockResolvedValue(undefined);
});
afterEach(()=>vi.restoreAllMocks());

describe('downloaded ship presentation contracts',()=>{
  it('never fabricates a replacement for an unavailable source',()=>{
    const factory=new ShipGeometryFactory();
    for(const kind of ['red-force','oro-jackson','queen-mama-chanter'] as const)
      expect(()=>factory.create(kind)).toThrow('downloaded source model is not available');
    factory.dispose();
  });
  it('every authored scenario uses vessels with reviewed source assets',()=>{
    for(const scenario of Object.values(SCENARIO_PRESETS))
      for(const ship of [scenario.player,...scenario.rivals])expect(hasSketchfabShip(ship.kind),ship.kind).toBe(true);
  });
  it.each(Object.keys(SKETCHFAB_SHIPS) as ShipKind[])('keeps every %s muzzle at the authoritative launch position',kind=>{
    const sim=new GameSimulation('source-mounts');sim.selectPlayerShip(kind);
    const ship=sim.getState().ships.find(s=>s.isPlayer)!;
    ship.heading=.82;ship.position={x:31,y:.8,z:-24};
    const factory=new ShipGeometryFactory(),model=factory.create(kind);
    model.root.position.set(ship.position.x,ship.position.y,ship.position.z);
    model.root.rotation.y=ship.heading;model.update(ship,0);model.root.updateMatrixWorld(true);
    for(const side of ['port','starboard','bow'] as const){
      const anchors=model.anchors[side==='port'?'portCannons':side==='starboard'?'starboardCannons':'bowCannons'];
      expect(anchors.length).toBeGreaterThan(0);
      for(const [index,anchor] of anchors.entries()){
        const point=anchor.getWorldPosition(new THREE.Vector3());
        const actual=sampleCannonTrajectory(ship,side,0,anchors.length>1?index/(anchors.length-1)-.5:0).position;
        expect(point.x).toBeCloseTo(actual.x,5);expect(point.y).toBeCloseTo(actual.y,5);expect(point.z).toBeCloseTo(actual.z,5);
      }
    }
    expect(model.root.userData.assetSource).toBe('sketchfab');
    expect(model.freeboardLift).toBe(0);
    model.dispose();factory.dispose();
  });
  it('grounds crew on the source deck under rotation and ignores sails above the station',()=>{
    const source=new THREE.Group();source.position.set(52,.8,-18);source.rotation.set(.04,.8,-.03);
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
    const deck=new THREE.Mesh(new THREE.PlaneGeometry(20,30),material);deck.rotation.x=-Math.PI/2;deck.position.y=4;
    const overhead=deck.clone();overhead.position.y=18;source.add(deck,overhead);
    const contact=sourceDeckContact(source,2,3,10);
    expect(contact).toBeDefined();expect(contact!.x).toBeCloseTo(2);expect(contact!.y).toBeCloseTo(4);expect(contact!.z).toBeCloseTo(3);
    expect(sourceDeckContact(source,80,3,10)).toBeUndefined();
    deck.geometry.dispose();material.dispose();
  });
});
