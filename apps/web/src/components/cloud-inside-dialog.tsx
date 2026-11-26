// 클라우드 내부 구조 창 (T0.70). 구름 안을 "포트별 에지 라우터 + 메시"로 그려 보여 준다 —
// 에지 라우터 i는 Port{i}의 /30 링크망 클라우드 쪽 주소를 들고, RIP로 배운 네트워크를 그 포트 아래에 늘어놓는다.
// 실제 내부 구현(ArpModule·RipModule)과는 추상화 수준이 다르지만, 동작 모델과 일치하게 그린다.

import { cloudPortInfo, maskToPrefixLength } from "@ping9/shared";
import type { DeviceView, TopologyDocument } from "@ping9/shared";
import { useEffect, useRef } from "react";

/** 에지 라우터 세 개의 자리 (구름 안, K3 메시) */
const NODE = [
  { x: 148, y: 104 },  // Fa0 — 왼쪽 위
  { x: 312, y: 104 },  // Fa1 — 오른쪽 위
  { x: 230, y: 222 },  // Fa2 — 아래 가운데
] as const;

/** 포트의 에지 라우터에서 바깥 장비 쪽으로 나가는 꼬리 방향 */
const TAIL = [
  { x: -50, y: -32 }, { x: 50, y: -32 }, { x: 0, y: 44 },
] as const;

/** K3 메시의 세 간선 */
const EDGES = [[0, 1], [0, 2], [1, 2]] as const;

/** 포트에 붙은 상대 장비의 이름 */
function peerName(document: TopologyDocument, deviceId: string, linkId: string | undefined): string | undefined {
  const link = document.links.find((candidate) => candidate.id === linkId);
  const peer = link?.ends.find((end) => end.deviceId !== deviceId);
  return document.devices.find((device) => device.id === peer?.deviceId)?.name;
}

export function CloudInsideDialog({ document, deviceId, view, onClose }: {
  readonly document: TopologyDocument;
  readonly deviceId: string;
  readonly view: Extract<DeviceView, { kind: "cloud" }>;
  readonly onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const device = document.devices.find((candidate) => candidate.id === deviceId);
  const learned = view.routes.filter((route) => route.source === "rip");

  return (
    <div className="confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cloud-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-inside-title">
        <div className="help-head">
          <strong id="cloud-inside-title">{device?.name ?? "Cloud"} 내부 구조</strong>
          <button ref={close} type="button" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <div className="cloud-body">
          <svg viewBox="0 0 460 330" className="cloud-inside" role="img"
            aria-label="클라우드 내부: 포트별 에지 라우터가 메시로 이어져 있고, 각 포트는 /30 링크로 바깥 장비와 연결됩니다">
            {/* 구름 본체 */}
            <path className="ci-cloud" d="M100 230a62 62 0 0 1-8-123 78 78 0 0 1 108-52 78 78 0 0 1 71 0 78 78 0 0 1 107 52 62 62 0 0 1-18 123Z" />
            {/* 망 대표 주소 */}
            <text className="ci-net" x="230" y="150" textAnchor="middle">1.0.0.0/8</text>
            {/* 에지 라우터 메시 (K3) */}
            {EDGES.map(([a, b]) => (
              <line key={`${a}-${b}`} className="ci-mesh" x1={NODE[a].x} y1={NODE[a].y} x2={NODE[b].x} y2={NODE[b].y} />
            ))}
            {NODE.map((node, index) => {
              const port = view.ports[index];
              const info = cloudPortInfo(index);
              const peer = peerName(document, deviceId, port?.linkId);
              const learnedHere = learned.filter((route) => route.port === port?.name);
              const tail = TAIL[index]!;
              return (
                <g key={index}>
                  {/* 바깥 장비로 가는 /30 꼬리 */}
                  <line className={peer === undefined ? "ci-tail off" : "ci-tail"}
                    x1={node.x} y1={node.y} x2={node.x + tail.x} y2={node.y + tail.y} />
                  <text className={peer === undefined ? "ci-link off" : "ci-link"}
                    x={node.x + tail.x * 0.62} y={node.y + tail.y * 0.62 - 4} textAnchor="middle">
                    {info.network}/30
                  </text>
                  <g className={peer === undefined ? "ci-peer off" : "ci-peer"}
                    transform={`translate(${node.x + tail.x} ${node.y + tail.y - 22})`}>
                    <rect x="-52" y="0" width="104" height="30" rx="6" />
                    <text x="0" y="12.5" textAnchor="middle" className="ci-peer-name">{peer ?? "연결 없음"}</text>
                    <text x="0" y="24" textAnchor="middle" className="ci-peer-ip">{peer === undefined ? info.network + "/30" : info.peerIp}</text>
                  </g>
                  {/* 에지 라우터 노드 */}
                  <circle className="ci-node" cx={node.x} cy={node.y} r="15" />
                  <text className="ci-node-name" x={node.x} y={node.y + 3.5} textAnchor="middle">R{index}</text>
                  <text className="ci-port" x={node.x} y={node.y + 27} textAnchor="middle">{port?.name ?? `Port${index}`} · {info.cloudIp}</text>
                  {/* 이 포트로 배운 네트워크 */}
                  {learnedHere.map((route, n) => (
                    <text key={`${route.network}-${n}`} className="ci-learned" x={node.x}
                      y={node.y + (index < 2 ? 40 : -21 - (learnedHere.length - 1 - n) * 11) + (index < 2 ? n * 11 : 0)}
                      textAnchor="middle">R {route.network}/{maskToPrefixLength(route.mask) ?? route.mask}</text>
                  ))}
                </g>
              );
            })}
          </svg>
          <div className="cloud-inside-summary">
            {learned.length === 0
              ? "배운 네트워크가 없어요 — 붙은 라우터에서 router rip과 network로 광고하면 여기에 나타나요"
              : `RIP로 ${learned.length}개 네트워크를 배워 다른 포트로 다시 광고하고 있어요`}
          </div>
        </div>
      </div>
    </div>
  );
}
