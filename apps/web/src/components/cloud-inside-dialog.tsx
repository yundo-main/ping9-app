// 클라우드 내부 구조 창 (T0.70). 구름 안을 "포트별 에지 라우터 + 메시"로 그려 보여 준다 —
// 에지 라우터 i는 Port{i}의 /30 링크망 클라우드 쪽 주소를 들고, RIP로 배운 네트워크를 그 포트 아래에 늘어놓는다.
// 실제 내부 구현(ArpModule·RipModule)과는 추상화 수준이 다르지만, 동작 모델과 일치하게 그린다.
// 포트 수가 바뀌어도 되게 노드는 원 둘레에 동적으로 놓는다 (T0.73 — 6포트로 늘리며 원형 배치로 전환).

import { cloudPortInfo, maskToPrefixLength, PORT_NAMES } from "@ping9/shared";
import type { DeviceView, TopologyDocument } from "@ping9/shared";
import { useEffect, useRef } from "react";

/** 구름 중심과 노드가 놓이는 타원의 반지름 */
const CENTER = { x: 230, y: 150 };
const RX = 98;
const RY = 60;

/** i번째 노드 — 위(-90°)에서 시작해 시계 방향으로 등간격 */
function nodeOf(index: number, count: number): { readonly x: number; readonly y: number; readonly dx: number; readonly dy: number } {
  const angle = (-90 + index * (360 / count)) * Math.PI / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  return { x: CENTER.x + RX * dx, y: CENTER.y + RY * dy, dx, dy };
}

/** 모든 노드 쌍의 메시 간선 */
function edges(count: number): readonly (readonly [number, number])[] {
  const result: [number, number][] = [];
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) result.push([a, b]);
  return result;
}

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
  const count = PORT_NAMES.cloud.length;
  const nodes = Array.from({ length: count }, (_, index) => nodeOf(index, count));
  const mesh = edges(count);

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
            <text className="ci-net" x={CENTER.x} y={CENTER.y - 4} textAnchor="middle">1.0.0.0/8</text>
            {/* 에지 라우터 메시 (풀메시) */}
            {mesh.map(([a, b]) => (
              <line key={`${a}-${b}`} className="ci-mesh"
                x1={nodes[a]!.x} y1={nodes[a]!.y} x2={nodes[b]!.x} y2={nodes[b]!.y} />
            ))}
            {nodes.map((node, index) => {
              const port = view.ports[index];
              const info = cloudPortInfo(index);
              const peer = peerName(document, deviceId, port?.linkId);
              const learnedHere = learned.filter((route) => route.port === port?.name);
              const tail = { x: node.x + node.dx * 58, y: node.y + node.dy * 58 };
              const boxH = 30 + learnedHere.length * 11;
              return (
                <g key={index}>
                  {/* 바깥 장비로 가는 /30 꼬리 */}
                  <line className={peer === undefined ? "ci-tail off" : "ci-tail"}
                    x1={node.x} y1={node.y} x2={tail.x} y2={tail.y} />
                  <text className={peer === undefined ? "ci-link off" : "ci-link"}
                    x={node.x + node.dx * 40} y={node.y + node.dy * 40 - 4} textAnchor="middle">
                    {info.network}/30
                  </text>
                  {/* 상대 장비 상자 + 그 포트로 배운 네트워크 */}
                  <g className={peer === undefined ? "ci-peer off" : "ci-peer"}
                    transform={`translate(${tail.x} ${tail.y - boxH / 2})`}>
                    <rect x="-52" y="0" width="104" height={boxH} rx="6" />
                    <text x="0" y="12.5" textAnchor="middle" className="ci-peer-name">{peer ?? "연결 없음"}</text>
                    <text x="0" y="24" textAnchor="middle" className="ci-peer-ip">{peer === undefined ? info.network + "/30" : info.peerIp}</text>
                    {learnedHere.map((route, n) => (
                      <text key={`${route.network}-${n}`} className="ci-learned" x="0" y={34 + n * 11}
                        textAnchor="middle">R {route.network}/{maskToPrefixLength(route.mask) ?? route.mask}</text>
                    ))}
                  </g>
                  {/* 에지 라우터 노드 */}
                  <circle className="ci-node" cx={node.x} cy={node.y} r="15" />
                  <text className="ci-node-name" x={node.x} y={node.y + 3.5} textAnchor="middle">R{index}</text>
                  <text className="ci-port" x={node.x + node.dx * 20} y={node.y + node.dy * 20 + 3}
                    textAnchor="middle">{port?.name ?? `Port${index}`} · {info.cloudIp}</text>
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
