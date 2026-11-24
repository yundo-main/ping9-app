// LB 모델 (T0.34): VIP:80으로 온 TCP SYN은 가중 라운드로빈으로 고른 백엔드로 DNAT되고,
// 백엔드의 응답은 출발지가 VIP로 되돌아간다. 클라이언트는 VIP 하나만 본다.
import { BROADCAST_MAC, validateTrace } from "@ping9/shared";
import type { DeviceView, FrameSnapshot, TopologyDocument, Trace } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createKernel } from "../../kernel";
import type { Frame, SimContext } from "../../kernel";
import { findDevice, portMac } from "../../topology";
import { deviceRun, transmit } from "../link";
import type { DeviceModel } from "../model";
import { HubModel } from "../hub/hub-model";
import { LbModel } from "./lb-model";

const EMPTY_VIEW: DeviceView = { kind: "pc", ports: [], arpTable: [] };

const IDS = {
  client: "00000000-0000-4000-8000-000000000021",
  srv1: "00000000-0000-4000-8000-000000000022",
  srv2: "00000000-0000-4000-8000-000000000023",
  lb: "00000000-0000-4000-8000-000000000024",
  hub: "00000000-0000-4000-8000-000000000025",
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
    { id: IDS.hub, kind: "hub", name: "HUB1", position: { x: 480, y: 200 }, config: {} },
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
    // 백엔드 세그먼트는 허브 하나로 잇는다 — eth1 포트에는 링크가 하나뿐이다
    { id: "00000000-0000-4000-8000-0000000000c2", ends: [{ deviceId: IDS.lb, port: "eth1" }, { deviceId: IDS.hub, port: "Port0" }] },
    { id: "00000000-0000-4000-8000-0000000000c3", ends: [{ deviceId: IDS.srv1, port: "Ethernet0" }, { deviceId: IDS.hub, port: "Port1" }] },
    { id: "00000000-0000-4000-8000-0000000000c4", ends: [{ deviceId: IDS.srv2, port: "Ethernet0" }, { deviceId: IDS.hub, port: "Port2" }] },
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
    // 허브 세그먼트는 모든 프레임이 다 온다 — 내 MAC도 브로드캐스트도 아니면 NIC가 버리는 것처럼 무시한다
    const destination = frame.snapshot.ethernet.destinationMac;
    const device = findDevice(document, this.deviceId)!;
    if (destination !== portMac(device, port) && destination !== BROADCAST_MAC &&
        findDevice(documentHttp, this.deviceId) !== undefined &&
        destination !== portMac(findDevice(documentHttp, this.deviceId)!, port)) return;
    const arp = frame.snapshot.arp;
    if (arp?.operation === "request") {
      // 우리 것이 아닌 ARP 요청은 답도 기록도 하지 않는다
      if (arp.targetIp !== this.ip) return;
      const device = findDevice(document, this.deviceId)!;
      transmit(ctx, document, { deviceId: this.deviceId, port }, ctx.createFrame({
        ethernet: { sourceMac: portMac(device, port), destinationMac: arp.senderMac },
        arp: { operation: "reply", senderMac: portMac(device, port), senderIp: this.ip,
               targetMac: arp.senderMac, targetIp: arp.senderIp },
      }));
      return;
    }
    if (arp !== undefined) return;
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
const models = new Map<string, DeviceModel>([[IDS.lb, lb], [IDS.hub, new HubModel(IDS.hub, () => document)], ...ends]);

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

// ── L7 (T0.35): http 모드는 프록시다. LB가 클라이언트 TCP를 직접 맺고 백엔드로 새 연결을 연다 ──

const documentHttp: TopologyDocument = {
  schemaVersion: 1,
  devices: [
    ...document.devices.filter(device => device.kind !== "lb"),
    {
      id: IDS.lb, kind: "lb", name: "LB1", position: { x: 350, y: 200 },
      config: {
        interfaces: {
          eth0: { ip: VIP, mask: "255.255.255.0", adminUp: true },
          eth1: { ip: "10.0.1.1", mask: "255.255.255.0", adminUp: true },
        },
        staticRoutes: [],
        frontends: [
          { listenPort: 80, mode: "http", backends: [
            { ip: SRV1_IP, port: 80, weight: 1, pathPrefix: "/api" },
            { ip: SRV2_IP, port: 80, weight: 1 },
          ] },
        ],
      },
    },
  ],
  links: document.links,
};

const lbHttp = new LbModel(IDS.lb, () => documentHttp);
const endsHttp = new Map([
  [IDS.client, new FakeEnd(IDS.client, CLIENT_IP)],
  [IDS.srv1, new FakeEnd(IDS.srv1, SRV1_IP)],
  [IDS.srv2, new FakeEnd(IDS.srv2, SRV2_IP)],
]);
const modelsHttp = new Map<string, DeviceModel>([[IDS.lb, lbHttp], [IDS.hub, new HubModel(IDS.hub, () => documentHttp)], ...endsHttp]);

function run(from: string, frame: FrameSnapshot, models = modelsHttp, doc = documentHttp): Trace {
  return createKernel().run(
    deviceRun({
      docVersion: 1,
      models,
      start: (ctx) => {
        transmit(ctx, doc, { deviceId: from, port: "Ethernet0" }, ctx.createFrame(frame));
      },
    }),
  );
}

function clientFrame(tcp: FrameSnapshot["tcp"], application?: FrameSnapshot["application"]): FrameSnapshot {
  return {
    ethernet: { sourceMac: macOf(IDS.client), destinationMac: lbMac("eth0") },
    ipv4: { sourceIp: CLIENT_IP, destinationIp: VIP, ttl: 64 },
    ...(tcp === undefined ? {} : { tcp }),
    ...(application === undefined ? {} : { application }),
  };
}

const reset = () => { for (const end of endsHttp.values()) end.arrivals.length = 0; };

describe("LbModel L7: http 프런트엔드는 프록시다", () => {
  test("SYN에는 LB가 직접 SYN-ACK으로 답한다 — 백엔드에는 아직 아무것도 안 간다", () => {
    reset();
    const trace = run(IDS.client, clientFrame( { sourcePort: 50000, destinationPort: 80, flags: "SYN" }));

    const got = endsHttp.get(IDS.client)!.arrivals;
    expect(got).toHaveLength(1);
    expect(got[0]!.frame.snapshot.tcp).toMatchObject({ sourcePort: 80, destinationPort: 50000, flags: "SYN-ACK" });
    expect(got[0]!.frame.snapshot.ipv4).toMatchObject({ sourceIp: VIP, destinationIp: CLIENT_IP });
    expect(endsHttp.get(IDS.srv1)!.arrivals).toHaveLength(0);
    expect(endsHttp.get(IDS.srv2)!.arrivals).toHaveLength(0);
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("요청 경로로 백엔드를 고른다 — /api는 접두가 맞는 백엔드로", () => {
    reset();
    run(IDS.client, clientFrame( { sourcePort: 50001, destinationPort: 80, flags: "SYN" }));
    run(IDS.client, clientFrame( { sourcePort: 50001, destinationPort: 80, flags: "ACK" }));
    const trace = run(IDS.client, clientFrame(
      { sourcePort: 50001, destinationPort: 80, flags: "PSH-ACK" },
      { service: "http", message: "GET /api/users" }));

    const routed = trace.events.filter(event => event.reason.code === "L7_REQUEST_ROUTED");
    expect(routed).toHaveLength(1);
    expect(routed[0]!.reason.params).toMatchObject({ backend: `${SRV1_IP}:80`, path: "/api/users" });

    // 백엔드 다리가 열린다 — 출발지는 LB의 나가는 인터페이스 IP다
    const got = endsHttp.get(IDS.srv1)!.arrivals;
    expect(got).toHaveLength(1);
    expect(got[0]!.frame.snapshot.ipv4).toMatchObject({ sourceIp: "10.0.1.1", destinationIp: SRV1_IP });
    expect(got[0]!.frame.snapshot.tcp?.flags).toBe("SYN");
    expect(endsHttp.get(IDS.srv2)!.arrivals).toHaveLength(0);
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("접두가 안 맞는 경로는 접두 없는 백엔드로 간다", () => {
    reset();
    run(IDS.client, clientFrame( { sourcePort: 50002, destinationPort: 80, flags: "SYN" }));
    run(IDS.client, clientFrame(
      { sourcePort: 50002, destinationPort: 80, flags: "PSH-ACK" },
      { service: "http", message: "GET /images/logo.png" }));

    expect(endsHttp.get(IDS.srv2)!.arrivals).toHaveLength(1);
    expect(endsHttp.get(IDS.srv1)!.arrivals).toHaveLength(0);
  });

  test("백엔드와 연결을 맺고 요청·응답을 중계한다 — 클라이언트는 VIP하고만 통신한다", () => {
    reset();
    const srv1 = endsHttp.get(IDS.srv1)!;
    run(IDS.client, clientFrame( { sourcePort: 50003, destinationPort: 80, flags: "SYN" }));
    run(IDS.client, clientFrame(
      { sourcePort: 50003, destinationPort: 80, flags: "PSH-ACK" },
      { service: "http", message: "GET /api/status" }));
    const synToBackend = srv1.arrivals[0]!.frame.snapshot.tcp!;

    // 백엔드가 SYN-ACK으로 답하면 LB는 ACK + 요청을 보낸다
    run(IDS.srv1, {
      ethernet: { sourceMac: macOf(IDS.srv1), destinationMac: lbMac("eth1") },
      ipv4: { sourceIp: SRV1_IP, destinationIp: "10.0.1.1", ttl: 64 },
      tcp: { sourcePort: 80, destinationPort: synToBackend.sourcePort, flags: "SYN-ACK" },
    });
    const request = srv1.arrivals.find(item => item.frame.snapshot.application !== undefined);
    expect(request?.frame.snapshot.application).toMatchObject({ service: "http", message: "GET /api/status" });
    expect(request?.frame.snapshot.ipv4?.sourceIp).toBe("10.0.1.1");

    // 백엔드의 응답은 VIP 주소로 클라이언트에게 간다
    run(IDS.srv1, {
      ethernet: { sourceMac: macOf(IDS.srv1), destinationMac: lbMac("eth1") },
      ipv4: { sourceIp: SRV1_IP, destinationIp: "10.0.1.1", ttl: 64 },
      tcp: { sourcePort: 80, destinationPort: synToBackend.sourcePort, flags: "PSH-ACK" },
      application: { service: "http", message: "200 OK", data: "up" },
    });
    const client = endsHttp.get(IDS.client)!.arrivals;
    const response = client.find(item => item.frame.snapshot.application !== undefined);
    expect(response?.frame.snapshot.ipv4).toMatchObject({ sourceIp: VIP, destinationIp: CLIENT_IP });
    expect(response?.frame.snapshot.application).toMatchObject({ message: "200 OK", data: "up" });
    expect(response?.frame.snapshot.tcp).toMatchObject({ sourcePort: 80, destinationPort: 50003 });
  });
});
