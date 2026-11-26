// PING9에 관하여 창 (T0.41) — 앱 이름·버전·원본/포크 개발자.
// 도움말 창 아래의 "PING9에 관하여" 링크로 연다. Esc·바깥 클릭은 공유 뒷판이 담당한다.

import { useEffect, useRef } from "react";
import logo from "../assets/logo.png";

export function AboutDialog({ onClose }: { readonly onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <div className="confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="help-head">
          <strong id="about-title">PING9에 관하여</strong>
          <button ref={close} type="button" aria-label="정보 닫기" onClick={onClose}>×</button>
        </div>
        <div className="about-body">
          <img className="about-logo" src={logo} alt="" />
          <p className="about-app">PING9 <span className="about-ver">1.0.0</span></p>
          <p className="about-desc">네트워크 장비를 배치하고 CLI로 설정해 통신을 실습하는 네트워크 시뮬레이터</p>
          <div className="about-credits">
            <section>
              <h3>원본 프로젝트</h3>
              <p>TL-cg11/PING9 — 웹 기반 네트워크 시뮬레이터 (3인 팀)</p>
              <p>Do-yoon Sung · Seon-yu Yong · Seon-young Min</p>
              <p className="about-url">github.com/TL-cg11/PING9</p>
            </section>
            <section>
              <h3>데스크톱 앱</h3>
              <p>jarrod kim — Tauri로 이식 (Windows·macOS)</p>
              <p className="about-url">github.com/yundo-main/ping9-app</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
