// 팔레트 도구의 3D 아이콘 (E6.10). 각 장비 종류를 오프스크린 WebGL로 한 번씩만
// 그려 PNG로 캐시하고 <img>로 붙인다 — 도구마다 살아 있는 WebGL 캔버스를 두지 않는다.
// 팔레트가 React.lazy로 불러와 three가 별도 청크로 빠진다. features.icons3d가 켜진 셸만 쓴다.

import { useEffect, useState } from "react";
import * as THREE from "three";
import type { DeviceKind } from "@ping9/shared";
import { DeviceIcon } from "./device-icons";
import { deviceModel } from "./device-models-3d";

const SIZE = 96;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | null = null;

function spriteUrl(kind: string): Promise<string> {
  const hit = cache.get(kind);
  if (hit !== undefined) return Promise.resolve(hit);
  const flying = pending.get(kind);
  if (flying !== undefined) return flying;
  const job = Promise.resolve().then(() => {
    if (renderer === null) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(SIZE, SIZE);
      renderer.setPixelRatio(2);
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fdcff, 0.6);
    rim.position.set(-4, 3, -3);
    scene.add(rim);
    const model = deviceModel(kind);
    model.position.y = -0.45;
    scene.add(model);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(1.5, 1.4, 2.3);
    camera.lookAt(0, 0.05, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    scene.traverse((node) => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
    cache.set(kind, url);
    pending.delete(kind);
    return url;
  });
  pending.set(kind, job);
  return job;
}

export function DeviceIcon3D({ kind }: { readonly kind: DeviceKind }) {
  const [url, setUrl] = useState<string | undefined>(() => cache.get(kind));
  useEffect(() => {
    let on = true;
    if (url === undefined) void spriteUrl(kind).then((done) => { if (on) setUrl(done); });
    return () => { on = false; };
  }, [kind, url]);
  if (url === undefined) return <DeviceIcon kind={kind} />;
  return <img className="icon icon3d" src={url} alt="" width={SIZE} height={SIZE} aria-hidden="true" />;
}
