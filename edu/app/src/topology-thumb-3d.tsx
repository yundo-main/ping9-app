// 레슨 카드의 3D 토폴로지 썸네일 — startDocument의 장비·링크를 three.js로 그린다 (E6.9).
// 장비 모델은 packages/editor의 공장(device-models-3d)을 쓴다 — 팔레트 3D 아이콘과 같은 그림.
// 천천히 도는 턴테이블 느낌. React.lazy로 불러 본체 three 청크와 나눠 쓴다.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Lesson } from "@ping9/edu-core";
import { deviceModel, linkTube, mesh, ICE } from "@ping9/editor/device-models-3d";

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
