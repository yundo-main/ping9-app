// LB 모델 (T0.34): VIP:80으로 온 TCP SYN은 가중 라운드로빈으로 고른 백엔드로 DNAT되고,
// 백엔드의 응답은 출발지가 VIP로 되돌아간다. 클라이언트는 VIP 하나만 본다.
import { validateTrace } from "@ping9/shared";
import type { DeviceView, FrameSnapshot, TopologyDocument, Trace } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createKernel } from "../../kernel";
import type { Frame, SimContext } from "../../kernel";
import { findDevice, portMac } from "../../topology";
import { deviceRun, transmit } from "../link";
import type { DeviceModel } from "../model";
import { LbModel } from "./lb-model";

const EMPTY_VIEW: DeviceView = { kind: "pc", ports: [], arpTable: [] };

const IDS = {
  client: "00000000-0000-4000-8000-000000000021",
  srv1: "00000000-0000-4000-8000-000000000022",
  srv2: "00000000-0000-4000-8000-000000000023",
  lb: "00000000-0000-4000-8000-000000000024",
} as const;

const CLIENT_IP = "10.0.0.2";
const VIP = "10.0.0.1";
const SRV1_IP = "10.0.1.10";
const SRV2_IP = "10.0.1.11";

// 클라이언트 ←→ LB eth0(10.0.0.1) , LB eth1(10.0.1.1) ←→ 백엔드 둘. 백엔드 세그먼트는 같은 링크다
const document: TopologyDocument = {
  schemaVersion: 1,
  devices: [
    { id: IDS.client, kind: "pc", name: "PC1", position: { x: 100, y: 200 }, config: {} },
    { id: IDS.srv1, kind: "server", name: "SRV1", position: { x: 600, y: 120 }, config: {} },
    { id: IDS.srv2, kind: "server", name: "SRV2", position: { x: 600, y: 280 }, config: {} },
    {
      id: IDS.lb, kind: "lb", name: "LB1", position: { x: 350, y: 200 },
      config: {
        interfaces: {
          eth0: { ip: VIP, mask: "255.255.255.0", adminUp: true },
          eth1: { ip: "10.0.1.1", mask: "255.255.255.0", adminUp: true },
        },
        staticRoutes: [],
        frontends: [
          { listenPort: 80, mode: "tcp", backends: [
            { ip: SRV1_IP, port: 80, weight: 1 },
            { ip: SRV2_IP, port: 80, weight: 2 },
          ] },
        ],
      },
    },
  ],
  links: [
    { id: "00000000-0000-4000-8000-0000000000c1", ends: [{ deviceId: IDS.client, port: "Ethernet0" }, { deviceId: IDS.lb, port: "eth0" }] },
    { id: "00000000-0000-4000-8000-0000000000c2", ends: [{ deviceId: IDS.srv1, port: "Ethernet0" }, { deviceId: IDS.lb, port: "eth1" }] },
    { id: "00000000-0000-4000-8000-0000000000c3", ends: [{ deviceId: IDS.srv2, port: "Ethernet0" }, { deviceId: IDS.lb, port: "eth1" }] },
  ],
};

function macOf(deviceId: string): string {
  return portMac(findDevice(document, deviceId)!, "Ethernet0");
}

/** IP를 가진 가짜 단말 — ARP 요청에는 답하고, 받은 프레임을 기록한다 */
class FakeEnd implements DeviceModel {
  readonly arrivals: { readonly port: string; readonly frame: Frame }[] = [];
  constructor(readonly deviceId: string, readonly ip: string) {}
  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    const arp = frame.snapshot.arp;
    if (arp?.operation === "request" && arp.targetIp === this.ip) {
      const device = findDevice(document, this.deviceId)!;
      transmit(ctx, document, { deviceId: this.deviceId, port }, ctx.createFrame({
        ethernet: { sourceMac: portMac(device, port), destinationMac: arp.senderMac },
        arp: { operation: "reply", senderMac: portMac(device, port), senderIp: this.ip,
               targetMac: arp.senderMac, targetIp: arp.senderIp },
      }));
      return;
    }
    this.arrivals.push({ port, frame });
  }
  onTimer(): void {}
  onConfigChanged(): void {}
  view(): DeviceView {
    return EMPTY_VIEW;
  }
}

const lb = new LbModel(IDS.lb, () => document);
const ends = new Map([
  [IDS.client, new FakeEnd(IDS.client, CLIENT_IP)],
  [IDS.srv1, new FakeEnd(IDS.srv1, SRV1_IP)],
  [IDS.srv2, new FakeEnd(IDS.srv2, SRV2_IP)],
]);
const models = new Map<string, DeviceModel>([[IDS.lb, lb], ...ends]);

function lbMac(port: string): string {
  return portMac(findDevice(document, IDS.lb)!, port);
}

function synFrame(sourcePort: number): FrameSnapshot {
  return {
    ethernet: { sourceMac: macOf(IDS.client), destinationMac: lbMac("eth0") },
    ipv4: { sourceIp: CLIENT_IP, destinationIp: VIP, ttl: 64 },
    tcp: { sourcePort, destinationPort: 80, flags: "SYN" },
  };
}

function send(frame: FrameSnapshot): Trace {
  return createKernel().run(
    deviceRun({
      docVersion: 1,
      models,
      start: (ctx) => {
        transmit(ctx, document, { deviceId: IDS.client, port: "Ethernet0" }, ctx.createFrame(frame));
      },
    }),
  );
}

const selected = (trace: Trace) =>
  trace.events.filter((event) => event.reason.code === "LB_BACKEND_SELECTED")
    .map((event) => (event.reason.params as { backend: string }).backend);

describe("LbModel: VIP로 온 SYN을 가중 라운드로빈으로 백엔드에 DNAT한다", () => {
  test("SYN은 백엔드를 골라 목적지를 재작성해 전달한다", () => {
    for (const end of ends.values()) end.arrivals.length = 0;

    const trace = send(synFrame(40000));

    expect(selected(trace)).toEqual([`${SRV1_IP}:80`]);
    const got = ends.get(IDS.srv1)!.arrivals;
    expect(got).toHaveLength(1);
    // 목적지는 백엔드로, 출발지는 클라이언트 그대로다
    expect(got[0]!.frame.snapshot.ipv4).toMatchObject({ sourceIp: CLIENT_IP, destinationIp: SRV1_IP, ttl: 63 });
    expect(got[0]!.frame.snapshot.tcp).toMatchObject({ sourcePort: 40000, destinationPort: 80, flags: "SYN" });
    expect(ends.get(IDS.srv2)!.arrivals).toHaveLength(0);
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("새 연결마다 가중치대로 백엔드를 돌린다 — weight 1:2", () => {
    for (const end of ends.values()) end.arrivals.length = 0;

    // 첫 테스트에서 커서가 1 움직였다 — 이어서 2,0,1 … 순으로 나온다
    const backends = [40001, 40002, 40003].flatMap(port => selected(send(synFrame(port))));
    expect(backends).toEqual([`${SRV2_IP}:80`, `${SRV2_IP}:80`, `${SRV1_IP}:80`]);
    expect(validateTrace(send(synFrame(40004))).ok).toBe(true);
  });

  test("백엔드의 응답은 출발지를 VIP로 되돌려 클라이언트에게 간다", () => {
    for (const end of ends.values()) end.arrivals.length = 0;
    // 라운드로빈 커서가 이어지므로 어느 백엔드로 갔는지 trace에서 읽는다
    const backendIp = selected(send(synFrame(40010)))[0]!.split(":")[0]!;
    const srv = backendIp === SRV1_IP ? IDS.srv1 : IDS.srv2;

    const reply: FrameSnapshot = {
      ethernet: { sourceMac: macOf(srv), destinationMac: lbMac("eth1") },
      ipv4: { sourceIp: backendIp, destinationIp: CLIENT_IP, ttl: 64 },
      tcp: { sourcePort: 80, destinationPort: 40010, flags: "SYN-ACK" },
    };
    const trace = createKernel().run(
      deviceRun({
        docVersion: 1,
        models,
        start: (ctx) => {
          transmit(ctx, document, { deviceId: srv, port: "Ethernet0" }, ctx.createFrame(reply));
        },
      }),
    );

    const got = ends.get(IDS.client)!.arrivals;
    expect(got).toHaveLength(1);
    expect(got[0]!.frame.snapshot.ipv4).toMatchObject({ sourceIp: VIP, destinationIp: CLIENT_IP });
    expect(got[0]!.frame.snapshot.tcp).toMatchObject({ sourcePort: 80, destinationPort: 40010 });
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("자기 IP로 온 ping에는 답하고, view에 바인딩이 보인다", () => {
    const trace = send({
      ethernet: { sourceMac: macOf(IDS.client), destinationMac: lbMac("eth0") },
      ipv4: { sourceIp: CLIENT_IP, destinationIp: VIP, ttl: 64 },
      icmp: { type: "echo-request", sequence: 7 },
    });
    expect(trace.events.some((event) => event.reason.code === "ICMP_ECHO_REPLY_SENT")).toBe(true);

    const view = lb.view();
    expect(view.kind).toBe("lb");
    if (view.kind === "lb") {
      expect(view.ports).toHaveLength(2);
      expect(view.bindings.length).toBeGreaterThan(0);
    }
  });
});
