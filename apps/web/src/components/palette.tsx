// 왼쪽 장비 목록. 시안의 <aside class="palette">와 같은 마크업이고, 아이콘은 T0.6의 장비 아이콘이다.
// 장비는 끌어 놓기로만 추가하고, 케이블 버튼은 연결 도구를 선택/해제한다.
// 여기서 끌어 간 새 장비를 이 목록에 다시 놓으면 추가되지 않는다 (T0.12). 놓았는지는 캔버스가 `zoneRef`의 자리로 판단한다.

import { LIMITS } from "@ping9/shared";
import type { PaletteKind } from "../canvas-interaction";
import { useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { DragCancelState } from "../canvas-interaction";
import { DeviceIcon } from "./device-icons";
import type { RouterCliStyle } from "./device-icons";

/** 목록 아래의 안내 한 줄. 평소(idle)에는 비우고, 끌기 취소 중에만 취소하는 방법을 알린다 (T0.50) */
const NOTE: Readonly<Record<DragCancelState, string>> = {
  idle: "",
  armed: "여기로 가져오면 취소",
  over: "놓으면 취소돼요",
};

/** 버튼에 올렸을 때 뜨는 툴팁 (T0.48). `title` 대신 data-tip으로 — 네이티브 툴팁은 늦게 뜬다 */
const TIPS: Readonly<Record<PaletteKind, string>> = {
  pc: "끌어서 배치 — ping·curl 같은 명령을 쓰는 단말",
  server: "끌어서 배치 — HTTP·DNS 같은 서비스를 돌리는 서버",
  switch: "끌어서 배치 — VLAN으로 네트워크를 나누는 L2 스위치",
  l3switch: "끌어서 배치 — VLAN 사이를 라우팅하는 L3 스위치",
  lb: "끌어서 배치 — 요청을 백엔드로 나누는 로드밸런서 (L4·L7)",
  hub: "끌어서 배치 — 들어온 걸 모든 포트로 보내는 허브 (L1)",
  router: "끌어서 배치 — 서로 다른 네트워크를 잇는 라우터 (L3)",
};

export function Palette({ deviceCount, linkCount = 0, onConnect, cableActive = false, selectActive = false, onSelectTool, onDeviceDragStart,
  dragCancel = "idle", zoneRef }: {
  readonly deviceCount: number;
  readonly linkCount?: number;
  readonly onConnect: () => void;
  readonly cableActive?: boolean;
  /** 선택 도구: 켜져 있으면 빈 곳 드래그가 범위 선택 (T0.43) */
  readonly selectActive?: boolean;
  readonly onSelectTool?: () => void;
  readonly onDeviceDragStart?: (kind: PaletteKind, cliStyle?: RouterCliStyle) => void;
  /** 새 장비 끌기와 취소 영역의 상태 (T0.12) */
  readonly dragCancel?: DragCancelState;
  readonly zoneRef?: RefObject<HTMLElement | null>;
}) {
  const used = Math.min(100, (deviceCount / LIMITS.maxDevices) * 100);
  const full = deviceCount >= LIMITS.maxDevices;
  const [switchesOpen, setSwitchesOpen] = useState(false);
  const [routersOpen, setRoutersOpen] = useState(false);

  const tool = (kind: PaletteKind, label: string, cliStyle?: RouterCliStyle, tip?: string): ReactNode => (
    <button key={cliStyle ?? kind} type="button" className="tool device-tool" aria-label={`${label} 추가`}
      data-tip={tip ?? TIPS[kind]} disabled={full} draggable={false}
      onPointerDown={event => {
        if (event.button !== 0 || full) return;
        event.preventDefault();
        onDeviceDragStart?.(kind, cliStyle);
      }}>
      <DeviceIcon kind={kind} cliStyle={cliStyle} />{label}
    </button>
  );

  return (
    <aside ref={zoneRef} className={dragCancel === "idle" ? "palette" : `palette cancel-${dragCancel}`}>
      <h4 data-tip="장비를 캔버스로 끌어서 배치하세요">장비</h4>
      {tool("pc", "PC")}
      {tool("server", "Server")}
      {/* 스위치는 한 버튼으로 묶는다. 누르면 옆에 뜨는 플라이아웃에서 고른다 — 목록 크기는 안 변한다 (T0.39) */}
      <div className="tool-group">
        <button type="button" className="tool group-tool" aria-label="Switch 종류" aria-expanded={switchesOpen}
          data-tip="눌러 스위치 종류를 고릅니다" disabled={full}
          onClick={() => setSwitchesOpen(open => !open)}>
          <DeviceIcon kind="switch" hideLayerBadge />Switch
        </button>
        {switchesOpen && (
          <div className="switch-flyout" role="group" aria-label="스위치 종류">
            {tool("switch", "L2 Switch")}
            {tool("l3switch", "L3 Switch")}
            {tool("lb", "LB")}
          </div>
        )}
      </div>
      {tool("hub", "Hub")}
      {/* 라우터도 한 버튼 — 플라이아웃에서 CLI 형식을 고른다 (T0.52). 배치한 뒤에도 인스펙터에서 바꿀 수 있다 */}
      <div className="tool-group">
        <button type="button" className="tool group-tool" aria-label="Router 종류" aria-expanded={routersOpen}
          data-tip="눌러 라우터 CLI 형식을 고릅니다" disabled={full}
          onClick={() => setRoutersOpen(open => !open)}>
          <DeviceIcon kind="router" hideLayerBadge />Router
        </button>
        {routersOpen && (
          <div className="switch-flyout" role="group" aria-label="라우터 CLI 형식">
            {tool("router", "Router (IOS)", "ios", "끌어서 배치 — Cisco식 명령어 (enable · configure terminal)")}
            {tool("router", "Router (VyOS)", "vyos", "끌어서 배치 — VyOS 명령어 (configure → set → commit)")}
            {tool("router", "Router (Linux)", "linux", "끌어서 배치 — 리눅스 명령어 (ip · sysctl)")}
          </div>
        )}
      </div>
      <p className="palette-note" aria-live="polite">{NOTE[dragCancel]}</p>
      <h4>도구</h4>
      <button type="button" className={selectActive ? "tool select-tool active" : "tool select-tool"}
        aria-label="범위 선택" aria-pressed={selectActive} onClick={onSelectTool}
        data-tip="빈 곳을 끌어 장비와 케이블을 상자로 고릅니다">
        <svg viewBox="0 0 32 32" fill="none" stroke="#3B8EF0" strokeWidth="2">
          <rect x="5" y="6" width="22" height="15" rx="1.5" strokeDasharray="4 3" />
          <path d="M10 10l9 4.5-4 1.2-1.8 3.8z" fill="#3B8EF0" stroke="none" />
        </svg>
        선택{selectActive && <span className="tool-selected">선택됨</span>}
      </button>
      <button type="button" className={cableActive ? "tool cable-tool active" : "tool cable-tool"}
        aria-label="케이블 연결" aria-pressed={cableActive} onClick={onConnect}
        data-tip="장비 두 곳을 차례로 눌러 케이블로 잇습니다"
        disabled={!cableActive && (deviceCount < 2 || linkCount >= LIMITS.maxLinks)}>
        <svg viewBox="0 0 32 32" fill="none" stroke="#DB5B91" strokeWidth="2" strokeLinecap="round">
          <path d="M6 24c6 0 6-16 20-16" />
          <circle cx="6" cy="24" r="2.5" fill="#DB5B91" />
          <circle cx="26" cy="8" r="2.5" fill="#DB5B91" />
        </svg>
        케이블{cableActive && <span className="tool-selected">선택됨</span>}
      </button>
      <div className="quota">
        장비 {deviceCount} / {LIMITS.maxDevices}
        <div className="bar">
          <i style={{ width: `${used}%` }} />
        </div>
      </div>
    </aside>
  );
}
