// 패킷 카드의 "헤더 구조" 보기 (T0.38 → T0.64 와이어샤크 모양). 요약 상자 대신
// Wireshark의 패킷 상세 창처럼 프로토콜별로 접히는 트리로 펼친다.
// 시뮬레이션이 값을 갖지 않는 필드(체크섬, 순서 번호, 길이)는 값을 지어내지 않고 "—"로 둔다.

import { isIcmpError } from "@ping9/shared";
import type { FrameSnapshot, IcmpMessage } from "@ping9/shared";
import type { ReactNode } from "react";

const SKIP = "—";

interface Field {
  readonly name: string;
  readonly value: ReactNode;
}

/** Wireshark의 프로토콜 줄 하나. summary는 "Ethernet II, Src: …, Dst: …" 같은 줄 머리 */
function Layer({ title, fields }: {
  readonly title: ReactNode;
  readonly fields: readonly Field[];
}) {
  return (
    <details open className="ws-layer">
      <summary>{title}</summary>
      <div className="ws-fields">
        {fields.map((field) => (
          <div key={field.name} className="ws-field">
            <span className="ws-fname">{field.name}</span>
            <span className="ws-fvalue">{field.value}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

const ICMP_TYPE_NO: Readonly<Record<IcmpMessage["type"], number>> = {
  "echo-request": 8, "echo-reply": 0, "destination-unreachable": 3, "time-exceeded": 11,
};

const ICMP_TYPE_TEXT: Readonly<Record<IcmpMessage["type"], string>> = {
  "echo-request": "Echo (ping) request",
  "echo-reply": "Echo (ping) reply",
  "destination-unreachable": "Destination unreachable",
  "time-exceeded": "Time to live exceeded",
};

function icmpFields(icmp: IcmpMessage): readonly Field[] {
  const fields: Field[] = [
    { name: "Type", value: `${ICMP_TYPE_NO[icmp.type]} (${ICMP_TYPE_TEXT[icmp.type]})` },
    { name: "Code", value: 0 },
    { name: "Checksum", value: SKIP },
  ];
  if (!isIcmpError(icmp)) {
    fields.push({ name: "Sequence Number", value: icmp.sequence });
  } else {
    fields.push({ name: "Original packet", value:
      `${icmp.original.sourceIp} → ${icmp.original.destinationIp}` +
      (icmp.original.protocol === undefined ? ` (sequence ${icmp.original.sequence})`
        : ` (${icmp.original.protocol.toUpperCase()} destination port ${icmp.original.destinationPort})`) });
  }
  return fields;
}

function ipv4Fields(ipv4: { readonly sourceIp: string; readonly destinationIp: string; readonly ttl: number },
  protocol: number | undefined, inner: string | undefined): readonly Field[] {
  return [
    { name: "Version", value: 4 },
    { name: "Header Length", value: "20 bytes (5)" },
    { name: "Differentiated Services Field", value: SKIP },
    { name: "Total Length", value: SKIP },
    { name: "Identification · Flags · Fragment", value: SKIP },
    { name: "Time to Live", value: ipv4.ttl },
    { name: "Protocol", value: protocol === undefined ? SKIP : `${inner} (${protocol})` },
    { name: "Header Checksum", value: SKIP },
    { name: "Source Address", value: ipv4.sourceIp },
    { name: "Destination Address", value: ipv4.destinationIp },
  ];
}

const TCP_FLAG_NO: Readonly<Record<string, string>> = {
  SYN: "0x002", "SYN-ACK": "0x012", ACK: "0x010", "PSH-ACK": "0x018", "FIN-ACK": "0x011", RST: "0x004",
};

const RIP_COMMAND_NO: Readonly<Record<string, number>> = { request: 1, response: 2 };

/** 프레임을 Wireshark의 패킷 상세 창처럼 펼친다. 바깥 Ethernet부터 안쪽 페이로드까지, 모든 계층이 형제 줄이다 */
export function PacketStructure({ frame, frameId }: {
  readonly frame: FrameSnapshot;
  /** 카드가 넘기는 프레임 번호 — Wireshark의 "Frame N" 줄 */
  readonly frameId?: number | undefined;
}) {
  const { ethernet, arp, ipv4, icmp, udp, tcp, rip, application, gre, esp } = frame;
  const layers: ReactNode[] = [];

  if (frameId !== undefined) {
    layers.push(<Layer key="frame" title={`Frame ${frameId}`} fields={[]} />);
  }

  // L2 — Ethernet II
  const etherType = arp !== undefined ? "ARP (0x0806)" : ipv4 !== undefined ? "IPv4 (0x0800)" : SKIP;
  layers.push(<Layer key="eth"
    title={`Ethernet II, Src: ${ethernet.sourceMac}, Dst: ${ethernet.destinationMac}`}
    fields={[
      { name: "Destination", value: ethernet.destinationMac },
      { name: "Source", value: ethernet.sourceMac },
      ...(ethernet.vlanTag === undefined ? [] : [
        { name: "802.1Q Tag Protocol Identifier", value: "0x8100" } satisfies Field,
        { name: "802.1Q Tag Control Information", value: `VLAN ${ethernet.vlanTag}` } satisfies Field,
      ]),
      { name: "Type", value: etherType },
    ]} />);

  if (arp !== undefined) {
    layers.push(<Layer key="arp"
      title={`Address Resolution Protocol (${arp.operation})`}
      fields={[
        { name: "Hardware type", value: "Ethernet (1)" },
        { name: "Protocol type", value: "IPv4 (0x0800)" },
        { name: "Hardware size · Protocol size", value: "6 · 4" },
        { name: "Opcode", value: `${arp.operation} (${arp.operation === "request" ? 1 : 2})` },
        { name: "Sender MAC address", value: arp.senderMac },
        { name: "Sender IP address", value: arp.senderIp },
        { name: "Target MAC address", value: arp.targetMac },
        { name: "Target IP address", value: arp.targetIp },
      ]} />);
  }

  // L3 — 외부 IPv4. 안쪽은 GRE·ESP 페이로드거나 TCP/UDP/ICMP다
  const tunnel = gre ?? esp;
  const l3Inner = tunnel !== undefined ? (gre !== undefined ? "GRE" : "ESP")
    : icmp !== undefined ? "ICMP" : tcp !== undefined ? "TCP" : udp !== undefined ? "UDP" : undefined;
  const l3Proto = l3Inner === undefined ? undefined
    : ({ ICMP: 1, TCP: 6, UDP: 17, GRE: 47, ESP: 50 } as const)[l3Inner];
  if (ipv4 !== undefined) {
    layers.push(<Layer key="ipv4"
      title={`Internet Protocol Version 4, Src: ${ipv4.sourceIp}, Dst: ${ipv4.destinationIp}`}
      fields={ipv4Fields(ipv4, l3Proto, l3Inner)} />);
  }

  if (gre !== undefined) {
    layers.push(<Layer key="gre" title="Generic Routing Encapsulation" fields={[
      { name: "Flags and Version", value: "0x0000" },
      { name: "Protocol Type", value: "IPv4 (0x0800)" },
    ]} />);
  }
  if (esp !== undefined) {
    layers.push(<Layer key="esp" title="Encapsulating Security Payload" fields={[
      { name: "SPI", value: `0x${esp.spi.toString(16)}` },
      { name: "Sequence Number", value: esp.sequence },
      { name: "Note", value: "암호화 없는 교육용 모델" },
    ]} />);
  }
  if (tunnel !== undefined) {
    layers.push(<Layer key="ipv4-in"
      title={`Internet Protocol Version 4 (inner), Src: ${tunnel.payload.ipv4.sourceIp}, Dst: ${tunnel.payload.ipv4.destinationIp}`}
      fields={ipv4Fields(tunnel.payload.ipv4, 1, "ICMP")} />);
    layers.push(<Layer key="icmp-in" title="Internet Control Message Protocol" fields={icmpFields(tunnel.payload.icmp)} />);
  }

  if (icmp !== undefined && tunnel === undefined) {
    layers.push(<Layer key="icmp" title="Internet Control Message Protocol" fields={icmpFields(icmp)} />);
  }

  // L4
  if (tcp !== undefined) {
    layers.push(<Layer key="tcp"
      title={`Transmission Control Protocol, Src Port: ${tcp.sourcePort}, Dst Port: ${tcp.destinationPort}`}
      fields={[
        { name: "Source Port", value: tcp.sourcePort },
        { name: "Destination Port", value: tcp.destinationPort },
        { name: "Sequence Number · Acknowledgment", value: SKIP },
        { name: "Header Length", value: "20 bytes (5)" },
        { name: "Flags", value: `${TCP_FLAG_NO[tcp.flags] ?? SKIP} (${tcp.flags.replace("-", "+")})` },
        { name: "Window", value: SKIP },
        { name: "Checksum · Urgent pointer", value: SKIP },
      ]} />);
  }
  if (udp !== undefined) {
    layers.push(<Layer key="udp"
      title={`User Datagram Protocol, Src Port: ${udp.sourcePort}, Dst Port: ${udp.destinationPort}`}
      fields={[
        { name: "Source Port", value: udp.sourcePort },
        { name: "Destination Port", value: udp.destinationPort },
        { name: "Length", value: SKIP },
        { name: "Checksum", value: SKIP },
      ]} />);
  }

  // L7
  if (rip !== undefined) {
    layers.push(<Layer key="rip" title="Routing Information Protocol" fields={[
      { name: "Command", value: `${rip.command} (${RIP_COMMAND_NO[rip.command] ?? "?"})` },
      { name: "Version", value: 2 },
      { name: "Route entries", value: rip.entries.length === 0 ? "none"
        : rip.entries.map(entry => `${entry.network}/${entry.mask} metric ${entry.metric}`).join(" · ") },
    ]} />);
  }
  if (application !== undefined) {
    layers.push(<Layer key="app" title={application.service.toUpperCase()} fields={[
      { name: "Message", value: application.message },
      ...(application.data === undefined ? [] : [{ name: "Data", value: application.data } satisfies Field]),
    ]} />);
  }

  return <div className="pkt-structure">{layers}</div>;
}
