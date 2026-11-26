// 레슨 카드의 토폴로지 썸네일 — startDocument의 장비 위치·링크를 미니 SVG로 그린다.
// designed-to-scale의 다이어그램 카드처럼, 카드만 봐도 어떤 네트워크를 만지는지 보이게 한다.

import type { Lesson } from "@ping9/edu-core";

const KIND_STYLE: Record<string, { readonly fill: string; readonly label: string }> = {
  pc: { fill: "#d6e5f6", label: "PC" },
  server: { fill: "#dff0de", label: "SV" },
  switch: { fill: "#e7ddf5", label: "SW" },
  l3switch: { fill: "#d5c8e2", label: "L3" },
  router: { fill: "#fcdcbd", label: "R" },
  hub: { fill: "#fde3a7", label: "H" },
  lb: { fill: "#f6e6c9", label: "LB" },
  cloud: { fill: "#fbf6ef", label: "☁" },
};

const W = 240;
const H = 132;
const PAD = 26;

export function TopologyThumb({ document }: { readonly document: Lesson["startDocument"] }) {
  const xs = document.devices.map((device) => device.position.x);
  const ys = document.devices.map((device) => device.position.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const cx = (x: number) => PAD + (x - minX) * scale + (W - PAD * 2 - spanX * scale) / 2;
  const cy = (y: number) => PAD + (y - minY) * scale + (H - PAD * 2 - spanY * scale) / 2;

  const at = new Map(document.devices.map((device) => [device.id, device]));

  return (
    <svg className="edu-thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {document.links.map((link) => {
        const a = at.get(link.ends[0].deviceId);
        const b = at.get(link.ends[1].deviceId);
        if (a === undefined || b === undefined) return null;
        return <line key={link.id} x1={cx(a.position.x)} y1={cy(a.position.y)}
          x2={cx(b.position.x)} y2={cy(b.position.y)} />;
      })}
      {document.devices.map((device) => {
        const style = KIND_STYLE[device.kind] ?? KIND_STYLE["pc"]!;
        return (
          <g key={device.id}>
            <rect x={cx(device.position.x) - 13} y={cy(device.position.y) - 11}
              width="26" height="22" rx="6" fill={style.fill} />
            <text x={cx(device.position.x)} y={cy(device.position.y) + 4} textAnchor="middle">{style.label}</text>
            <text className="edu-thumb-name" x={cx(device.position.x)} y={cy(device.position.y) + 24} textAnchor="middle">{device.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
