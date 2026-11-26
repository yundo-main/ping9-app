// 장비 아이콘 (T0.6). PC는 이글루, Switch는 갈림길 표지판, Router는 열린 관문이다.
// 필터 규칙(iptables)을 건 서버는 이글루 오른쪽 위에 방패 배지를 단다 (T0.21. T14.2.3의 Firewall 방패를 옮김).
// 시안의 펭귄·물고기 은유를 따른다: 펭귄이 사는 집, 길을 알려 주는 표지판, 다른 동네로 가는 문.
// 캔버스와 왼쪽 장비 목록이 같은 그림을 쓴다. 모두 32×32 기준이다.

import type { SVGProps } from "react";

import type { DeviceKind, PcOsChoice } from "@ping9/shared";

type Box = Pick<SVGProps<SVGSVGElement>, "x" | "y" | "width" | "height">;

const LINE = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * 이글루. OS마다 창과 문이 다르다 (T0.7). 작게 그려도 구분되도록 모양으로 나눈다.
 * - Linux: 둥근 문과 그 위의 검은 터미널 간판(`>_`)
 * - Windows: 큰 유리창(제목 줄이 있는 앱 창 모양)과 넓은 네모 문
 * - Server: 이글루가 아니라 세워 둔 랙(`Rack`)으로 완전히 다른 실루엣이다 (T0.23)
 * - OS 없음: T0.6의 원래 그림(둥근 문과 노란 작은 창). OS를 고르기 전인 장비 목록이 쓴다
 */
function Igloo({ os }: { readonly os: PcOsChoice | undefined }) {
  const blue = "#1A5FA8";
  // 이글루는 납작해서 다른 그림보다 작아 보인다. 바닥선을 기준으로 1.2배 키운다
  return (
    <g transform="translate(16 25.8) scale(1.2) translate(-16 -25.8)">
      <path d="M5 25.5A11 11 0 0 1 27 25.5Z" fill="#E6F0FB" stroke={blue} strokeWidth="1.1" {...LINE} />
      <path
        d="M7 21h18M9.5 17.5h13M11.5 21v4.5M20.5 21v4.5M16 17.5V21"
        fill="none"
        stroke="#A8C8EC"
        strokeWidth="0.8"
        {...LINE}
      />
      {os === undefined ? (
        <>
          <path d="M13 25.5v-3.5a3 3 0 0 1 6 0v3.5Z" fill={blue} />
          <rect x="20" y="18.2" width="3.2" height="2.5" rx="0.7" fill="#F5C36B" stroke={blue} strokeWidth="0.7" />
        </>
      ) : os === "linux" ? (
        <g className="igloo-linux">
          <path d="M13 25.5v-2.9a3 3 0 0 1 6 0v2.9Z" fill={blue} />
          <rect x="11.8" y="16.9" width="8.4" height="3.3" rx="0.9" fill="#0E1A38" />
          <path d="M14.2 17.8l1 0.75-1 0.75M15.9 19.3h1.8" fill="none" stroke="#7FD3F7" strokeWidth="0.55" {...LINE} />
        </g>
      ) : (
        <g className="igloo-windows">
          <rect x="10.8" y="17.1" width="10.4" height="5.1" rx="0.8" fill="#B9D6F3" stroke={blue} strokeWidth="0.7" />
          <path d="M10.8 18.5v-0.6a0.8 0.8 0 0 1 0.8-0.8h8.8a0.8 0.8 0 0 1 0.8 0.8v0.6Z" fill={blue} />
          <circle cx="11.8" cy="17.85" r="0.28" fill="#fff" />
          <circle cx="12.7" cy="17.85" r="0.28" fill="#fff" />
          <path d="M12.8 21.2l1.7-1.7M14.1 21.4l2.1-2.1" fill="none" stroke="#fff" strokeWidth="0.45" {...LINE} />
          <path d="M12.6 25.5v-1.9a0.9 0.9 0 0 1 0.9-0.9h5a0.9 0.9 0 0 1 0.9 0.9v1.9Z" fill={blue} />
        </g>
      )}
      <path d="M3.5 25.8h25" fill="none" stroke={blue} strokeWidth="1.1" {...LINE} />
    </g>
  );
}

function Signpost() {
  const purple = "#4B3DB8";
  const sign = { fill: "#EEEDFD", stroke: "#5B4BD1", strokeWidth: 1, ...LINE } as const;
  return (
    <>
      <ellipse cx="16" cy="27.6" rx="9.5" ry="1.8" fill="#E6E4FB" stroke="#5B4BD1" strokeWidth="0.9" />
      <path d="M16 6.5h9l2.6 2.6-2.6 2.6h-9Z" {...sign} />
      <path d="M16 12.8H7.4l-2.6 2.6 2.6 2.6H16Z" {...sign} />
      <path d="M16 19.1h7l2.4 2.4-2.4 2.4h-7Z" {...sign} />
      <path d="M16 3v24.5" fill="none" stroke={purple} strokeWidth="1.6" {...LINE} />
      <circle cx="19.2" cy="9.1" r="0.9" fill="#5B4BD1" />
      <circle cx="12.6" cy="15.4" r="0.9" fill="#5B4BD1" />
      <circle cx="19.2" cy="21.5" r="0.9" fill="#5B4BD1" />
    </>
  );
}

/** 허브 (T0.32). 들어온 신호를 나머지 포트 모두로 반복하는 장비 — 가운데 노드에서 사방으로 퍼지는 선 */
function Hub() {
  const orange = "#B45309";
  return (
    <>
      <ellipse cx="16" cy="27.6" rx="9.5" ry="1.8" fill="#FBEEDF" stroke={orange} strokeWidth="0.9" />
      <rect x="7" y="10" width="18" height="12" rx="2" fill="#FDEEDA" stroke={orange} strokeWidth="1.1" {...LINE} />
      <circle cx="16" cy="16" r="1.6" fill={orange} />
      {[10.5, 13.7, 16.9, 20.1].map((y) => (
        <path key={y} d={`M16 16L${8.8 + (y - 10.5) * 1.35} ${y + 4.2}`} fill="none" stroke={orange} strokeWidth="1" {...LINE} />
      ))}
      <circle cx="10.3" cy="12.5" r="0.9" fill={orange} />
      <circle cx="13.5" cy="13.5" r="0.9" fill={orange} />
      <circle cx="16.7" cy="14.5" r="0.9" fill={orange} />
      <circle cx="19.9" cy="15.5" r="0.9" fill={orange} />
    </>
  );
}

/** L3 스위치 (T0.33). L2 이정표에 IP 층을 그린다 — 가운데 막대 대신 위로 가는 화살표 */
function L3Switch() {
  const teal = "#0F766E";
  const sign = { fill: "#E6F7F4", stroke: "#14B8A6", strokeWidth: 1, ...LINE } as const;
  return (
    <>
      <ellipse cx="16" cy="27.6" rx="9.5" ry="1.8" fill="#DDF3EF" stroke="#14B8A6" strokeWidth="0.9" />
      <path d="M16 9h9l2.6 2.6-2.6 2.6h-9Z" {...sign} />
      <path d="M16 15.5H7.4l-2.6 2.6 2.6 2.6H16Z" {...sign} />
      <path d="M16 22h7l2.4 2.4-2.4 2.4h-7Z" {...sign} />
      <path d="M16 3v24.5" fill="none" stroke={teal} strokeWidth="1.6" {...LINE} />
      <path d="M16 3.5l-2.2 3h4.4Z" fill={teal} />
      <circle cx="19.2" cy="11.6" r="0.9" fill="#14B8A6" />
      <circle cx="12.6" cy="18.1" r="0.9" fill="#14B8A6" />
      <circle cx="19.2" cy="24.4" r="0.9" fill="#14B8A6" />
    </>
  );
}

/** LB (T0.34). 가운데 추 하나에서 세 갈래로 나뉘는 부하 분산 */
function Lb() {
  const c = "#7C3AED";
  return (
    <>
      <ellipse cx="16" cy="27.6" rx="9.5" ry="1.8" fill="#EDE9FE" stroke="#8B5CF6" strokeWidth="0.9" />
      <path d="M16 6v16" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16" cy="6" r="2" fill="#EDE9FE" stroke={c} strokeWidth="1.2" />
      <path d="M16 22 7 26M16 22l0 4.5M16 22l9 4" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="26" r="1.8" fill="#EDE9FE" stroke={c} strokeWidth="1.1" />
      <circle cx="16" cy="26.5" r="1.8" fill="#EDE9FE" stroke={c} strokeWidth="1.1" />
      <circle cx="25" cy="26" r="1.8" fill="#EDE9FE" stroke={c} strokeWidth="1.1" />
    </>
  );
}

/** 인터넷 클라우드 (T0.68). ISP 라우터 망 — 구름 안에 라우터 셋이 메시로 이어져 있다 */
function Cloud() {
  const c = "#0284C7";
  return (
    <>
      <ellipse cx="16" cy="27.6" rx="9.5" ry="1.8" fill="#E0F2FE" stroke={c} strokeWidth="0.9" />
      <path d="M8.5 21.5a4.4 4.4 0 0 1-.5-8.8A5.8 5.8 0 0 1 16 8.6a5.4 5.4 0 0 1 5.1 3.4 4.7 4.7 0 0 1 2.4 9.5Z"
        fill="#E0F2FE" stroke={c} strokeWidth="1.1" {...LINE} />
      <path d="M11.6 16.4l4.4 1.9M20.4 14.6l-4.4 3.7M11.6 19.8l4.4-1.5M20.4 19.2l-4.4-1.1" fill="none"
        stroke={c} strokeWidth="0.85" strokeLinecap="round" />
      <circle cx="11.6" cy="16.4" r="1.15" fill="#E0F2FE" stroke={c} strokeWidth="0.85" />
      <circle cx="20.4" cy="14.6" r="1.15" fill="#E0F2FE" stroke={c} strokeWidth="0.85" />
      <circle cx="20.4" cy="19.2" r="1.15" fill="#E0F2FE" stroke={c} strokeWidth="0.85" />
      <circle cx="16" cy="18.3" r="1.15" fill="#E0F2FE" stroke={c} strokeWidth="0.85" />
      <circle cx="11.6" cy="19.8" r="1.15" fill="#E0F2FE" stroke={c} strokeWidth="0.85" />
    </>
  );
}

/** 관문의 기둥과 지붕. 열린 문과 닫힌 문이 같이 쓴다 */
function GateFrame() {
  const green = "#17725F";
  const edge = { stroke: green, strokeWidth: 1, ...LINE } as const;
  return (
    <>
      <rect x="3.5" y="5" width="25" height="4.2" rx="1.6" fill="#A3E2CB" {...edge} />
      <rect x="5.5" y="9.2" width="4.6" height="16.6" rx="0.8" fill="#E2F5EF" {...edge} />
      <rect x="21.9" y="9.2" width="4.6" height="16.6" rx="0.8" fill="#E2F5EF" {...edge} />
      <path d="M3 25.8h26" fill="none" stroke={green} strokeWidth="1.1" {...LINE} />
    </>
  );
}

function GateOpen() {
  const door = { fill: "#5FC9A5", stroke: "#17725F", strokeWidth: 0.9, ...LINE } as const;
  return (
    <>
      <GateFrame />
      <path d="M10.1 11l4 1.6v11.6l-4 1.6Z" {...door} />
      <path d="M21.9 11l-4 1.6v11.6l4 1.6Z" {...door} />
    </>
  );
}

/**
 * 경로가 없을 때: 문이 닫히고 가운데에 빨간 X.
 * 아직 이 상태를 보여 주는 화면이 없다. 실패 사유 표시(T1.10.2)에서 쓴다
 */
export function GateClosedIcon(box: Box) {
  return (
    <svg className="icon icon-blocked" viewBox="0 0 32 32" aria-hidden="true" {...box}>
      <GateFrame />
      <rect x="10.1" y="9.2" width="11.8" height="16.6" fill="#5FC9A5" stroke="#17725F" strokeWidth="0.9" />
      <path d="M16 9.2v16.6" stroke="#17725F" strokeWidth="0.8" />
      <circle cx="16" cy="17.5" r="4.6" fill="#E04848" />
      <path d="M14.2 15.7l3.6 3.6M17.8 15.7l-3.6 3.6" stroke="#fff" strokeWidth="1.5" {...LINE} />
    </svg>
  );
}

export type ShieldState = "idle" | "allow" | "deny";

/**
 * 필터의 방패 (T14.2.3). 평소는 분홍 바탕에 흰 별표,
 * 펭귄이 허용되면 초록 체크, 막히면 빨간 X. 펭귄 층이 같은 자리에 겹쳐 그린다
 */
function Shield({ state }: { readonly state: ShieldState }) {
  const [fill, edge] = state === "allow" ? ["#1E9E6A", "#0F6B47"] : state === "deny" ? ["#E04848", "#A12828"] : ["#D6517A", "#8E2A4C"];
  return (
    <g className={`shield shield-${state}`}>
      <path d="M23.5 8.6L29.6 11v6.4c0 4.2-2.7 7.3-6.1 9-3.4-1.7-6.1-4.8-6.1-9V11Z" fill={fill} stroke={edge} strokeWidth="1.1" {...LINE} />
      <path
        d={state === "allow" ? "M20.8 17.3l2 2 3.9-4.2" : state === "deny" ? "M21.4 15l4.2 4.2M25.6 15l-4.2 4.2" : "M23.5 14v6M20.9 15.5l5.2 3M20.9 18.5l5.2-3"}
        fill="none" stroke="#fff" strokeWidth={state === "idle" ? 1.3 : 1.7} {...LINE}
      />
    </g>
  );
}

/**
 * 서버 아이콘 위 방패 배지의 자리 (32 격자). 방패 그림(가운데가 23.5, 17.5)을 줄여 이글루 오른쪽 위에 둔다.
 * 펭귄 층이 같은 자리에 허용·차단 방패를 겹쳐 그리고, DROP된 물고기가 이리로 날아간다
 */
export const FILTER_BADGE = { x: 26.4, y: 11.4, scale: 0.6 } as const;

/** 필터 규칙을 건 서버의 방패 배지 (T0.21) */
export function FilterBadge({ state }: { readonly state: ShieldState }) {
  return (
    <g className="filter-badge" transform={`translate(${FILTER_BADGE.x} ${FILTER_BADGE.y}) scale(${FILTER_BADGE.scale}) translate(-23.5 -17.5)`}>
      <Shield state={state} />
    </g>
  );
}

/** 오른쪽 아래에 달리는 계층 배지 (T0.37). L1 허브, L2 스위치, L3 스위치, L4·L7 LB, 라우터 CLI 형식 (T0.52) */
function LayerBadge({ text }: { readonly text: string }) {
  // 글자 수가 많으면 알약을 넓힌다 (Linux 같은 다섯 글자)
  const width = text.length <= 2 ? 10 : text.length <= 4 ? 16 : 21;
  return (
    <g transform={`translate(${30.8 - width} 21.4)`}>
      <rect width={width} height="9" rx="2.5" fill="#1E293B" stroke="#FFFFFF" strokeWidth="0.8" />
      <text x={width / 2} y="6.8" textAnchor="middle" fontSize="6.2" fontWeight="700" fill="#FFFFFF"
        fontFamily="system-ui, -apple-system, sans-serif">{text}</text>
    </g>
  );
}

/** 라우터 배지에 적는 CLI 형식 (T0.52). RouterConfig.cliStyle과 같은 값 */
export type RouterCliStyle = "ios" | "vyos" | "linux";
const CLI_STYLE_BADGE: Readonly<Record<RouterCliStyle, string>> = { ios: "IOS", vyos: "VyOS", linux: "Linux" };

/**
 * 서버(종류가 Server인 PC). 세워 둔 랙 — 이글루(집)와 실루엣이 완전히 다르다 (T0.23).
 * 세 층의 검은 서랍에 초록 불빛이 켜져 있다. 작게 그려도 PC와 바로 구분되도록 둥근 지붕이 없다.
 */
function Rack() {
  const blue = "#1A5FA8";
  return (
    <g className="rack-server">
      <rect x="9.5" y="5.5" width="13" height="21" rx="1.6" fill="#E6F0FB" stroke={blue} strokeWidth="1.1" {...LINE} />
      {[8.6, 13.9, 19.2].map((y) => (
        <g key={y}>
          <rect x="11.3" y={y} width="9.4" height="3.1" rx="0.7" fill="#0E1A38" />
          <circle cx="12.7" cy={y + 1.55} r="0.55" fill="#6FE3A1" />
          <path d={`M14.4 ${y + 1.55}h4.8`} stroke="#7FD3F7" strokeWidth="0.55" {...LINE} />
        </g>
      ))}
    </g>
  );
}

/**
 * `os`는 PC에만 쓴다 (T0.7). 캔버스는 `osOf`로 늘 넘긴다.
 * 넘기지 않으면 OS가 없는 원래 이글루다 (장비 목록).
 * `filtering`: 필터 규칙을 건 서버다. 방패 배지를 단다 (T0.21)
 */
export function DeviceIcon({ kind, os, filtering = false, hideLayerBadge = false, cliStyle = "ios", ...box }: {
  readonly kind: DeviceKind; readonly os?: PcOsChoice; readonly filtering?: boolean;
  /** 팔레트의 묶음 버튼처럼 한 계층을 뜻하지 않을 때 배지를 뺀다 (T0.39) */
  readonly hideLayerBadge?: boolean;
  /** 라우터의 CLI 형식 — 배지로 표시한다 (T0.52) */
  readonly cliStyle?: RouterCliStyle;
} & Box) {
  const osClass = (kind === "pc" || kind === "server") && os !== undefined ? ` icon-os-${os}` : "";
  return (
    <svg className={`icon icon-${kind}${osClass}`} viewBox="0 0 32 32" aria-hidden="true" {...box}>
      {kind === "pc" ? (os === "server" ? <Rack /> : <Igloo os={os} />) : kind === "server" ? <Rack /> : kind === "switch" ? <Signpost /> : kind === "hub" ? <Hub /> : kind === "l3switch" ? <L3Switch /> : kind === "lb" ? <Lb /> : kind === "cloud" ? <Cloud /> : <GateOpen />}
      {!hideLayerBadge && kind === "hub" && <LayerBadge text="L1" />}
      {!hideLayerBadge && kind === "cloud" && <LayerBadge text="WAN" />}
      {!hideLayerBadge && kind === "switch" && <LayerBadge text="L2" />}
      {!hideLayerBadge && kind === "l3switch" && <LayerBadge text="L3" />}
      {!hideLayerBadge && kind === "lb" && <LayerBadge text="L4·7" />}
      {!hideLayerBadge && kind === "router" && <LayerBadge text={CLI_STYLE_BADGE[cliStyle]} />}
      {(kind === "pc" || kind === "server") && filtering && <FilterBadge state="idle" />}
    </svg>
  );
}
