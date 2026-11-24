// 왼쪽 장비 목록. 시안의 <aside class="palette">와 같은 마크업이고, 아이콘은 T0.6의 장비 아이콘이다.
// 장비는 끌어 놓기로만 추가하고, 케이블 버튼은 연결 도구를 선택/해제한다.
// 여기서 끌어 간 새 장비를 이 목록에 다시 놓으면 추가되지 않는다 (T0.12). 놓았는지는 캔버스가 `zoneRef`의 자리로 판단한다.

import { LIMITS } from "@ping9/shared";
import type { PaletteKind } from "../canvas-interaction";
import { useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { DragCancelState } from "../canvas-interaction";
import { DeviceIcon } from "./device-icons";

/** 목록 아래의 안내 한 줄. 끄는 중에는 취소하는 방법을 알린다 */
const NOTE: Readonly<Record<DragCancelState, string>> = {
  idle: "장비를 끌어서 배치",
  armed: "여기로 가져오면 취소",
  over: "놓으면 취소돼요",
};

export function Palette({ deviceCount, linkCount = 0, onConnect, cableActive = false, onDeviceDragStart,
  dragCancel = "idle", zoneRef }: {
  readonly deviceCount: number;
  readonly linkCount?: number;
  readonly onConnect: () => void;
  readonly cableActive?: boolean;
  readonly onDeviceDragStart?: (kind: PaletteKind) => void;
  /** 새 장비 끌기와 취소 영역의 상태 (T0.12) */
  readonly dragCancel?: DragCancelState;
  readonly zoneRef?: RefObject<HTMLElement | null>;
}) {
  const used = Math.min(100, (deviceCount / LIMITS.maxDevices) * 100);
  const full = deviceCount >= LIMITS.maxDevices;
  const [switchesOpen, setSwitchesOpen] = useState(false);

  const tool = (kind: PaletteKind, label: string): ReactNode => (
    <button key={kind} type="button" className="tool device-tool" aria-label={`${label} 추가`}
      title={`${label}를 캔버스로 끌어서 놓으세요`} disabled={full} draggable={false}
      onPointerDown={event => {
        if (event.button !== 0 || full) return;
        event.preventDefault();
        onDeviceDragStart?.(kind);
      }}>
      <DeviceIcon kind={kind} />{label}
    </button>
  );

  return (
    <aside ref={zoneRef} className={dragCancel === "idle" ? "palette" : `palette cancel-${dragCancel}`}>
      <h4>장비</h4>
      {tool("pc", "PC")}
      {tool("server", "Server")}
      {/* 스위치는 한 버튼으로 묶는다. 누르면 옆에 뜨는 플라이아웃에서 고른다 — 목록 크기는 안 변한다 (T0.39) */}
      <div className="tool-group">
        <button type="button" className="tool group-tool" aria-label="Switch 종류" aria-expanded={switchesOpen}
          title="눌러 스위치 종류를 고르세요" disabled={full}
          onClick={() => setSwitchesOpen(open => !open)}>
          <DeviceIcon kind="switch" hideLayerBadge />Switch
          <span className="group-caret" aria-hidden="true">{switchesOpen ? "◂" : "▸"}</span>
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
      {tool("router", "Router")}
      <p className="palette-note" aria-live="polite">{NOTE[dragCancel]}</p>
      <h4>연결</h4>
      <button type="button" className={cableActive ? "tool cable-tool active" : "tool cable-tool"}
        aria-label="케이블 연결" aria-pressed={cableActive} onClick={onConnect}
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
