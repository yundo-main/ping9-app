// Hub 모델 (T0.32): 받은 포트를 빼고 링크가 있는 모든 포트로 보낸다.
// VLAN도 MAC 테이블도 없다 — 학습 이벤트가 없고, 누가 보냈는지 보지 않는다.
import { BROADCAST_MAC, validateTrace } from "@ping9/shared";
import type { DeviceView, FrameSnapshot, TopologyDocument, Trace } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createKernel } from "../../kernel";
import type { Frame, SimContext } from "../../kernel";
import { findDevice, portMac } from "../../topology";
import { deviceRun, transmit } from "../link";
import type { DeviceModel } from "../model";
import { HubModel } from "./hub-model";

const PC_PORT = "Ethernet0";
const EMPTY_VIEW: DeviceView = { kind: "pc", ports: [], arpTable: [] };

const IDS = {
  pc1: "00000000-0000-4000-8000-000000000011",
  pc2: "00000000-0000-4000-8000-000000000012",
  pc3: "00000000-0000-4000-8000-000000000014",
  hub: "00000000-0000-4000-8000-000000000013",
} as const;

// PC 3대가 Hub의 Port0~2에 연결된 문서. Port3~7은 비어 있다
const document: TopologyDocument = {
  schemaVersion: 1,
  devices: [
    { id: IDS.pc1, kind: "pc", name: "PC1", position: { x: 150, y: 320 }, config: {} },
    { id: IDS.pc2, kind: "pc", name: "PC2", position: { x: 550, y: 320 }, config: {} },
    { id: IDS.pc3, kind: "pc", name: "PC3", position: { x: 550, y: 120 }, config: {} },
    { id: IDS.hub, kind: "hub", name: "HUB1", position: { x: 350, y: 160 }, config: {} },
  ],
  links: [
    { id: "00000000-0000-4000-8000-0000000000b1", ends: [{ deviceId: IDS.pc1, port: PC_PORT }, { deviceId: IDS.hub, port: "Port0" }] },
    { id: "00000000-0000-4000-8000-0000000000b2", ends: [{ deviceId: IDS.pc2, port: PC_PORT }, { deviceId: IDS.hub, port: "Port1" }] },
    { id: "00000000-0000-4000-8000-0000000000b3", ends: [{ deviceId: IDS.pc3, port: PC_PORT }, { deviceId: IDS.hub, port: "Port2" }] },
  ],
};

/** 받은 것을 적어 두기만 하는 가짜 PC */
class FakePc implements DeviceModel {
  readonly arrivals: { readonly port: string; readonly frame: Frame; readonly time: number }[] = [];
  constructor(readonly deviceId: string) {}
  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    this.arrivals.push({ port, frame, time: ctx.now() });
  }
  onTimer(): void {}
  onConfigChanged(): void {}
  view(): DeviceView {
    return EMPTY_VIEW;
  }
}

function macOf(deviceId: string): string {
  return portMac(findDevice(document, deviceId)!, PC_PORT);
}

function frameTo(from: string, to: string): FrameSnapshot {
  return {
    ethernet: { sourceMac: macOf(from), destinationMac: to },
    arp: {
      operation: "request",
      senderMac: macOf(from),
      senderIp: "0.0.0.0",
      targetMac: "00:00:00:00:00:00",
      targetIp: "0.0.0.0",
    },
  };
}

const hub = new HubModel(IDS.hub, () => document);
const pcs = new Map([IDS.pc1, IDS.pc2, IDS.pc3].map((id) => [id, new FakePc(id)]));
const models = new Map<string, DeviceModel>([[IDS.hub, hub], ...pcs]);

function send(from: string, to: string): Trace {
  return createKernel().run(
    deviceRun({
      docVersion: 1,
      models,
      start: (ctx) => {
        transmit(ctx, document, { deviceId: from, port: PC_PORT }, ctx.createFrame(frameTo(from, to)));
      },
    }),
  );
}

const codes = (trace: Trace, deviceId: string) =>
  trace.events.filter((event) => event.deviceId === deviceId).map((event) => event.reason.code);

describe("HubModel: PC 3대와 Hub 1대", () => {
  test("들어온 포트를 빼고 링크가 있는 포트 모두로 보낸다 — 학습이 없다", () => {
    for (const pc of pcs.values()) pc.arrivals.length = 0;

    const trace = send(IDS.pc1, BROADCAST_MAC);

    // 받음 하나 + 나가는 포트마다 HUB_FLOODED 하나. 링크 없는 Port3~7에는 이벤트도 없다
    expect(codes(trace, IDS.hub)).toEqual(["FRAME_RECEIVED", "HUB_FLOODED", "HUB_FLOODED"]);
    const flooded = trace.events.filter((event) => event.reason.code === "HUB_FLOODED");
    expect(flooded.map((event) => event.outPort)).toEqual(["Port1", "Port2"]);
    expect(flooded.every((event) => event.action === "forward" && event.inPort === "Port0")).toBe(true);
    expect(flooded.every((event) => event.linkId !== undefined)).toBe(true);
    for (const event of flooded) expect(event.reason.params).toMatchObject({ broadcast: true });

    // 두 PC 모두 받고, 보낸 쪽으로는 되돌아가지 않는다
    expect(pcs.get(IDS.pc2)!.arrivals).toHaveLength(1);
    expect(pcs.get(IDS.pc3)!.arrivals).toHaveLength(1);
    expect(pcs.get(IDS.pc1)!.arrivals).toHaveLength(0);
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("유니캐스트도 가리지 않고 모두로 보낸다 — 허브는 MAC을 보지 않는다", () => {
    for (const pc of pcs.values()) pc.arrivals.length = 0;

    const trace = send(IDS.pc1, macOf(IDS.pc2));

    expect(codes(trace, IDS.hub)).toEqual(["FRAME_RECEIVED", "HUB_FLOODED", "HUB_FLOODED"]);
    for (const event of trace.events.filter((item) => item.reason.code === "HUB_FLOODED")) {
      expect(event.reason.params).toMatchObject({ broadcast: false });
    }
    expect(pcs.get(IDS.pc2)!.arrivals).toHaveLength(1);
    expect(pcs.get(IDS.pc3)!.arrivals).toHaveLength(1);
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("view는 포트 상태 목록뿐이다 — MAC 표가 없다", () => {
    const view = hub.view();
    expect(view.kind).toBe("hub");
    if (view.kind === "hub") {
      expect(view.ports).toHaveLength(8);
      expect(view.ports.filter((port) => port.status === "up")).toHaveLength(3);
      expect(view.ports.filter((port) => port.status === "no-link")).toHaveLength(5);
    }
  });
});
