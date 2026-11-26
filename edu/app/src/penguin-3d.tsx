// 3D 펭귄 — 로고의 납작한 펭귄을 three.js 프리미티브로 재현한 마스코트 (E6.8).
// 로그인 카드처럼 작은 칸에 넣고, 좌우로 살랑살랑 회전하며 떠다닌다.
// 지연 로딩(React.lazy)으로 쓴다 — 로그인 화면 번들을 가볍게 유지하기 위해.

import { useEffect, useRef } from "react";
import * as THREE from "three";

const NAVY = 0x262a47;
const WHITE = 0xf4f9ff;
const BEAK = 0xf5b230;
const ICE = 0xbfd9f7;
const PUPIL = 0x11131f;

export function Penguin3D({ size = 170 }: { readonly size?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (el === null) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 1.3, 6.4);
    camera.lookAt(0, 0.7, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const navy = new THREE.MeshStandardMaterial({ color: NAVY, roughness: 0.65 });
    const white = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.5 });
    const beakMat = new THREE.MeshStandardMaterial({ color: BEAK, roughness: 0.45 });
    const iceMat = new THREE.MeshStandardMaterial({ color: ICE, roughness: 0.3 });
    const pupil = new THREE.MeshStandardMaterial({ color: PUPIL, roughness: 0.35 });

    const penguin = new THREE.Group();

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), navy);
    body.scale.set(1, 1.18, 0.92);
    body.position.y = 1.02;

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.74, 40, 30), white);
    belly.scale.set(0.88, 1.05, 0.55);
    belly.position.set(0, 0.92, 0.6);

    const eyeGeo = new THREE.SphereGeometry(0.17, 24, 18);
    const eyeL = new THREE.Mesh(eyeGeo, white);
    eyeL.scale.set(1, 1.3, 0.55);
    eyeL.position.set(-0.33, 1.66, 0.74);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.33;

    const pupilGeo = new THREE.SphereGeometry(0.075, 16, 12);
    const pupilL = new THREE.Mesh(pupilGeo, pupil);
    pupilL.position.set(-0.33, 1.68, 0.9);
    const pupilR = pupilL.clone();
    pupilR.position.x = 0.33;

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 24), beakMat);
    beak.position.set(0, 1.45, 0.95);
    beak.rotation.x = Math.PI / 2;

    const wingGeo = new THREE.SphereGeometry(0.4, 28, 20);
    const wingL = new THREE.Mesh(wingGeo, navy);
    wingL.scale.set(0.32, 1, 0.55);
    wingL.position.set(-0.95, 1.08, 0.05);
    wingL.rotation.z = 0.4;
    const wingR = wingL.clone();
    wingR.position.x = 0.95;
    wingR.rotation.z = -0.4;

    const footGeo = new THREE.SphereGeometry(0.3, 24, 16);
    const footL = new THREE.Mesh(footGeo, beakMat);
    footL.scale.set(1, 0.35, 1.45);
    footL.position.set(-0.42, 0.05, 0.4);
    const footR = footL.clone();
    footR.position.x = 0.42;

    const floe = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.95, 0.3, 7), iceMat);
    floe.position.y = -0.18;

    penguin.add(body, belly, eyeL, eyeR, pupilL, pupilR, beak, wingL, wingR, footL, footR, floe);
    scene.add(penguin);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fdcff, 0.7);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      penguin.rotation.y = Math.sin(t * 0.55) * 0.55;
      penguin.position.y = Math.sin(t * 1.3) * 0.07;
      wingL.rotation.z = 0.4 + Math.sin(t * 1.3) * 0.12;
      wingR.rotation.z = -0.4 - Math.sin(t * 1.3) * 0.12;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [size]);

  return <div ref={host} className="edu-penguin3d" style={{ width: size, height: size }} role="img" aria-label="PING9 펭귄" />;
}
