// 레슨 카드의 3D 토폴로지 썸네일 — startDocument의 장비·링크를 three.js로 그린다 (E6.9).
// 장비 종류마다 간단한 프리미티브 모델을 만들고, 링크는 얇은 원기둥으로 연결한다.
// 천천히 도는 턴테이블 느낌. React.lazy로 불러 본체 three 청크와 나눠 쓴다.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Lesson } from "@ping9/edu-core";

const NAVY = 0x262a47;
const BODY = 0xe6f1fe;
const SCREEN = 0x8fdcff;
const ICE = 0xbfd9f7;
const BEAK = 0xf5b230;
const LINK = 0x9dbde8;
const ACCENTS: Record<string, number> = {
  pc: 0xd3e6fc, server: 0xcfe9dc, switch: 0x8fc4fa, l3switch: 0x6fa8ef,
  router: 0xfcdcbd, hub: 0xf9e3ae, lb: 0xf6d9c9, cloud: 0xffffff,
};

function mesh(geometry: THREE.BufferGeometry, color: number, rough = 0.55) {
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: rough }));
}

/** 장비 종류별 3D 모델 — 카드 크기에서 알아볼 수 있는 실루엣 위주로 */
function deviceModel(kind: string): THREE.Group {
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
function linkTube(a: THREE.Vector3, b: THREE.Vector3) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const length = a.distanceTo(b);
  const tube = mesh(new THREE.CylinderGeometry(0.025, 0.025, length, 8), LINK, 0.6);
  tube.position.copy(mid);
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return tube;
}

export function TopologyThumb3D({ document }: { readonly document: Lesson["startDocument"] }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (el === null) return;

    const W = 240;
    const H = 110;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    // 문서 좌표를 세계 좌표로 — x→x, y→z(평면에 눕힘), 중심 맞춤
    const xs = document.devices.map((device) => device.position.x);
    const ys = document.devices.map((device) => device.position.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const scale = 4.4 / span;
    const at = new Map<string, THREE.Vector3>();

    const world = new THREE.Group();
    for (const device of document.devices) {
      const x = (device.position.x - minX) * scale - (maxX - minX) * scale / 2;
      const z = (device.position.y - minY) * scale - (maxY - minY) * scale / 2;
      const model = deviceModel(device.kind);
      model.position.set(x, 0, z);
      model.scale.setScalar(0.62);
      world.add(model);
      at.set(device.id, new THREE.Vector3(x, 0.1, z));
    }
    for (const link of document.links) {
      const a = at.get(link.ends[0].deviceId);
      const b = at.get(link.ends[1].deviceId);
      if (a !== undefined && b !== undefined) world.add(linkTube(a, b));
    }

    const board = mesh(new THREE.CylinderGeometry(3.1, 3.4, 0.14, 8), ICE, 0.35);
    board.position.y = -0.1;
    world.add(board);
    scene.add(world);

    const center = new THREE.Vector3(0, 0.3, 0);
    const radius = Math.max(4.2, (maxX - minX) * scale * 0.72 + 2);
    camera.position.set(0, radius * 0.9, radius * 0.95);
    camera.lookAt(center);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fdcff, 0.5);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      world.rotation.y = Math.sin(t * 0.4) * 0.4;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [document]);

  return <div ref={host} className="edu-thumb3d" />;
}
