// L3 Switch 모델 (T0.33): 같은 VLAN은 L2로, 게이트웨이 MAC으로 온 패킷은 SVI가 받아 라우팅한다.
import { validateTrace } from "@ping9/shared";
import type { DeviceView, FrameSnapshot, L3SwitchConfig, TopologyDocument, Trace } from "@ping9/shared";
import { describe, expect, test } from "vitest";

import { createKernel } from "../../kernel";
import type { Frame, SimContext } from "../../kernel";
import { findDevice, portMac } from "../../topology";
import { deviceRun, transmit } from "../link";
import type { DeviceModel } from "../model";
import { L3SwitchModel } from "./l3switch-model";

const PC_PORT = "Ethernet0";
const EMPTY_VIEW: DeviceView = { kind: "pc", ports: [], arpTable: [] };

const IDS = {
  pc1: "00000000-0000-4000-8000-000000000021",
  pc2: "00000000-0000-4000-8000-000000000022",
  sw: "00000000-0000-4000-8000-000000000023",
} as const;

const config: L3SwitchConfig = {
  vlans: [
    { id: 1, name: "default" },
    { id: 10, name: "VLAN0010" },
    { id: 20, name: "VLAN0020" },
  ],
  ports: {
    "FastEthernet0/1": { adminUp: true, mode: "access", accessVlan: 10 },
    "FastEthernet0/2": { adminUp: true, mode: "access", accessVlan: 20 },
  },
  ipRouting: true,
  interfaces: {
    Vlan10: { adminUp: true, ip: "10.0.10.1", mask: "255.255.255.0" },
    Vlan20: { adminUp: true, ip: "10.0.20.1", mask: "255.255.255.0" },
  },
  staticRoutes: [],
};

const document: TopologyDocument = {
  schemaVersion: 1,
  devices: [
    { id: IDS.pc1, kind: "pc", name: "PC1", position: { x: 100, y: 300 }, config: {} },
    { id: IDS.pc2, kind: "pc", name: "PC2", position: { x: 600, y: 300 }, config: {} },
    { id: IDS.sw, kind: "l3switch", name: "L3SW1", position: { x: 350, y: 150 }, config },
  ],
  links: [
    { id: "00000000-0000-4000-8000-0000000000c1", ends: [{ deviceId: IDS.pc1, port: PC_PORT }, { deviceId: IDS.sw, port: "FastEthernet0/1" }] },
    { id: "00000000-0000-4000-8000-0000000000c2", ends: [{ deviceId: IDS.pc2, port: PC_PORT }, { deviceId: IDS.sw, port: "FastEthernet0/2" }] },
  ],
};

function macOf(deviceId: string): string {
  return portMac(findDevice(document, deviceId)!, PC_PORT);
}

/** L3 스위치의 시스템 MAC — 모든 L3 인터페이스가 나눠 쓴다 */
const SYSTEM_MAC = portMac(findDevice(document, IDS.sw)!, "FastEthernet0/1");

/** 자기 IP를 묻는 ARP 요청에는 답하고, 나머지 프레임은 받은 것만 적는 가짜 PC */
class FakePc implements DeviceModel {
  readonly arrivals: { readonly port: string; readonly frame: Frame; readonly time: number }[] = [];
  constructor(readonly deviceId: string, readonly ip: string) {}
  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    const arp = frame.snapshot.arp;
    if (arp?.operation === "request" && arp.targetIp === this.ip) {
      const reply = ctx.createFrame({
        ethernet: { sourceMac: macOf(this.deviceId), destinationMac: arp.senderMac },
        arp: {
          operation: "reply", senderMac: macOf(this.deviceId), senderIp: this.ip,
          targetMac: arp.senderMac, targetIp: arp.senderIp,
        },
      });
      transmit(ctx, document, { deviceId: this.deviceId, port: PC_PORT }, reply);
      return;
    }
    this.arrivals.push({ port, frame, time: ctx.now() });
  }
  onTimer(): void {}
  onConfigChanged(): void {}
  view(): DeviceView {
    return EMPTY_VIEW;
  }
}

const sw = new L3SwitchModel(IDS.sw, () => document, () => 0);
const pc1 = new FakePc(IDS.pc1, "10.0.10.2");
const pc2 = new FakePc(IDS.pc2, "10.0.20.2");
const models = new Map<string, DeviceModel>([[IDS.sw, sw], [IDS.pc1, pc1], [IDS.pc2, pc2]]);

function send(frame: FrameSnapshot, from: string = IDS.pc1): Trace {
  return createKernel().run(
    deviceRun({
      docVersion: 1,
      models,
      start: (ctx) => {
        transmit(ctx, document, { deviceId: from, port: PC_PORT }, ctx.createFrame(frame));
      },
    }),
  );
}

const codes = (trace: Trace, deviceId: string) =>
  trace.events.filter((event) => event.deviceId === deviceId).map((event) => event.reason.code);

describe("L3SwitchModel: VLAN 2개와 SVI 게이트웨이", () => {
  test("SVI IP를 묻는 ARP에는 게이트웨이가 답한다 — 브로드캐스트는 플러딩도 된다", () => {
    pc1.arrivals.length = 0;
    pc2.arrivals.length = 0;

    const trace = send({
      ethernet: { sourceMac: macOf(IDS.pc1), destinationMac: "ff:ff:ff:ff:ff:ff" },
      arp: {
        operation: "request", senderMac: macOf(IDS.pc1), senderIp: "10.0.10.2",
        targetMac: "00:00:00:00:00:00", targetIp: "10.0.10.1",
      },
    });

    expect(pc1.arrivals).toHaveLength(1);
    const reply = pc1.arrivals[0]!.frame.snapshot.arp;
    expect(reply?.operation).toBe("reply");
    expect(reply?.senderMac).toBe(SYSTEM_MAC);
    expect(reply?.senderIp).toBe("10.0.10.1");
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("게이트웨이 MAC으로 온 IP 패킷은 다른 VLAN의 SVI로 라우팅된다 — TTL이 하나 준다", () => {
    pc2.arrivals.length = 0;

    const trace = send({
      ethernet: { sourceMac: macOf(IDS.pc1), destinationMac: SYSTEM_MAC },
      ipv4: { sourceIp: "10.0.10.2", destinationIp: "10.0.20.2", ttl: 64 },
      icmp: { type: "echo-request", sequence: 1 },
    });

    expect(codes(trace, IDS.sw)).toContain("IPV4_FORWARDED");
    expect(pc2.arrivals).toHaveLength(1);
    const frame = pc2.arrivals[0]!.frame.snapshot;
    expect(frame.ipv4?.ttl).toBe(63);
    // 나가는 프레임은 시스템 MAC을 출발지로, 목적지 MAC은 ARP로 구한 PC2다
    expect(frame.ethernet.sourceMac).toBe(SYSTEM_MAC);
    expect(frame.ethernet.destinationMac).toBe(macOf(IDS.pc2));
    expect(frame.ethernet.vlanTag).toBeUndefined();
    expect(validateTrace(trace).ok).toBe(true);
  });

  test("no ip routing이면 자기 것이 아닌 패킷을 버린다 — L2 통과는 그대로다", () => {
    const off: TopologyDocument = {
      ...document,
      devices: document.devices.map(device => device.id === IDS.sw && device.kind === "l3switch"
        ? { ...device, config: { ...config, ipRouting: undefined } } : device),
    };
    const offModel = new L3SwitchModel(IDS.sw, () => off, () => 0);
    pc2.arrivals.length = 0;

    const trace = createKernel().run(
      deviceRun({
        docVersion: 1,
        models: new Map<string, DeviceModel>([[IDS.sw, offModel], [IDS.pc1, pc1], [IDS.pc2, pc2]]),
        start: (ctx) => {
          transmit(ctx, off, { deviceId: IDS.pc1, port: PC_PORT }, ctx.createFrame({
            ethernet: { sourceMac: macOf(IDS.pc1), destinationMac: SYSTEM_MAC },
            ipv4: { sourceIp: "10.0.10.2", destinationIp: "10.0.20.2", ttl: 64 },
            icmp: { type: "echo-request", sequence: 1 },
          }));
        },
      }),
    );

    expect(codes(trace, IDS.sw)).toContain("IP_FORWARD_DISABLED");
    expect(pc2.arrivals).toHaveLength(0);
    expect(validateTrace(trace).ok).toBe(true);
  });
});
