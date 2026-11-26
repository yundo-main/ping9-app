// 장비 종류별 three.js 프리미티브 모델 공장 (E6.10).
// edu의 레슨 3D 썸네일과 팔레트의 3D 도구 아이콘이 같은 모델을 쓴다.
// 카드·아이콘 크기에서 알아볼 수 있는 실루엣 위주다.

import * as THREE from "three";

const NAVY = 0x262a47;
const BODY = 0xe6f1fe;
const SCREEN = 0x8fdcff;
export const ICE = 0xbfd9f7;
const LINK = 0x9dbde8;
const ACCENTS: Record<string, number> = {
  pc: 0xd3e6fc, server: 0xcfe9dc, switch: 0x8fc4fa, l3switch: 0x6fa8ef,
  router: 0xfcdcbd, hub: 0xf9e3ae, lb: 0xf6d9c9, cloud: 0xffffff,
};

export function mesh(geometry: THREE.BufferGeometry, color: number, rough = 0.55) {
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: rough }));
}

export function deviceModel(kind: string): THREE.Group {
  const g = new THREE.Group();
  const accent = ACCENTS[kind] ?? BODY;
  if (kind === "pc") {
    const screen = mesh(new THREE.BoxGeometry(0.9, 0.62, 0.08), NAVY, 0.4);
    screen.position.y = 0.62;
    const face = mesh(new THREE.BoxGeometry(0.78, 0.5, 0.02), SCREEN, 0.3);
    face.position.set(0, 0.62, 0.05);
    const stand = mesh(new THREE.BoxGeometry(0.12, 0.28, 0.12), NAVY);
    stand.position.y = 0.24;
    const base = mesh(new THREE.BoxGeometry(0.5, 0.08, 0.34), NAVY);
    base.position.y = 0.08;
    g.add(screen, face, stand, base);
  } else if (kind === "switch" || kind === "l3switch" || kind === "hub" || kind === "lb") {
    const box = mesh(new THREE.BoxGeometry(1.1, 0.3, 0.62), accent, 0.5);
    box.position.y = 0.15;
    const face = mesh(new THREE.BoxGeometry(1.02, 0.16, 0.04), NAVY, 0.4);
    face.position.set(0, 0.14, 0.3);
    g.add(box, face);
    for (let i = 0; i < 4; i += 1) {
      const port = mesh(new THREE.BoxGeometry(0.1, 0.08, 0.03), SCREEN, 0.3);
      port.position.set(-0.36 + i * 0.24, 0.14, 0.33);
      g.add(port);
    }
  } else if (kind === "router") {
    const box = mesh(new THREE.BoxGeometry(0.9, 0.32, 0.9), accent, 0.5);
    box.position.y = 0.16;
    const top = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24), NAVY, 0.4);
    top.position.y = 0.36;
    const antL = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), NAVY, 0.4);
    antL.position.set(-0.3, 0.6, -0.25);
    const antR = antL.clone();
    antR.position.x = 0.3;
    g.add(box, top, antL, antR);
  } else if (kind === "server") {
    const tower = mesh(new THREE.BoxGeometry(0.55, 1.0, 0.8), accent, 0.5);
    tower.position.y = 0.5;
    const slot = mesh(new THREE.BoxGeometry(0.4, 0.06, 0.04), NAVY, 0.4);
    slot.position.set(0, 0.72, 0.42);
    const slot2 = slot.clone();
    slot2.position.y = 0.55;
    const led = mesh(new THREE.SphereGeometry(0.04, 12, 8), SCREEN, 0.2);
    led.position.set(-0.15, 0.28, 0.42);
    g.add(tower, slot, slot2, led);
  } else {
    const puff = mesh(new THREE.SphereGeometry(0.5, 24, 16), ICE, 0.35);
    puff.scale.set(1.3, 0.7, 0.8);
    puff.position.y = 0.4;
    const puff2 = mesh(new THREE.SphereGeometry(0.34, 20, 14), ICE, 0.35);
    puff2.position.set(-0.4, 0.32, 0);
    const puff3 = mesh(new THREE.SphereGeometry(0.3, 20, 14), ICE, 0.35);
    puff3.position.set(0.45, 0.35, 0);
    g.add(puff, puff2, puff3);
  }
  return g;
}

/** 두 점 사이를 잇는 얇은 원기둥 */
export function linkTube(a: THREE.Vector3, b: THREE.Vector3) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const length = a.distanceTo(b);
  const tube = mesh(new THREE.CylinderGeometry(0.025, 0.025, length, 8), LINK, 0.6);
  tube.position.copy(mid);
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return tube;
}
