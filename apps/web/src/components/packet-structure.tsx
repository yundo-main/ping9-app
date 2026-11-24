// 패킷 카드의 "헤더 구조" 보기 (T0.38). 요약 상자 대신 실제 헤더 해부도대로
// 필드·바이트·값의 표로 펼친다. 시뮬레이션이 값을 갖지 않는 필드(체크섬, 순서 번호,
// 길이)는 값을 지어내지 않고 "—"로 둔다.

import { isIcmpError } from "@ping9/shared";
import type { FrameSnapshot, IcmpMessage } from "@ping9/shared";
import type { ReactNode } from "react";

const SKIP = "—";

interface Field {
  readonly name: string;
  readonly bytes: string;
  readonly value: ReactNode;
}

function Section({ title, bytes, fields, payload }: {
  readonly title: string; readonly bytes: string; readonly fields: readonly Field[];
  readonly payload?: string | undefined;
}) {
  return (
    <section className="pkt-sec">
      <h5>{title}<span>{bytes}</span></h5>
      <table className="pkt-fields">
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <td className="pkt-fname">{field.name}</td>
              <td className="pkt-fbytes">{field.bytes}</td>
              <td className="pkt-fvalue">{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {payload !== undefined && <div className="pkt-payload">▼ 페이로드 → {payload}</div>}
    </section>
  );
}

const ICMP_TYPE_NO: Readonly<Record<IcmpMessage["type"], number>> = {
  "echo-request": 8, "echo-reply": 0, "destination-unreachable": 3, "time-exceeded": 11,
};

function icmpFields(icmp: IcmpMessage): readonly Field[] {
  const fields: Field[] = [
    { name: "종류 Type", bytes: "1B", value: `${ICMP_TYPE_NO[icmp.type]} (${icmp.type})` },
    { name: "코드 Code", bytes: "1B", value: 0 },
    { name: "체크섬", bytes: "2B", value: SKIP },
  ];
  if (!isIcmpError(icmp)) {
    fields.push({ name: "식별·순번", bytes: "4B", value: `순번 ${icmp.sequence}` });
  } else {
    fields.push({ name: "원래 패킷 앞부분", bytes: "≥28B", value:
      `${icmp.original.sourceIp} → ${icmp.original.destinationIp}` +
      (icmp.original.protocol === undefined ? ` (순번 ${icmp.original.sequence})`
        : ` (${icmp.original.protocol.toUpperCase()} 도착 포트 ${icmp.original.destinationPort})`) });
  }
  return fields;
}

function ipv4Section(title: string, ipv4: { readonly sourceIp: string; readonly destinationIp: string; readonly ttl: number },
  protocol: number | undefined, inner: string | undefined): ReactNode {
  return (
    <Section key={title} title={title} bytes="20 바이트" fields={[
      { name: "버전·헤더 길이", bytes: "1B", value: "4 · IHL 5" },
      { name: "DSCP·ECN", bytes: "1B", value: SKIP },
      { name: "전체 길이", bytes: "2B", value: SKIP },
      { name: "식별·플래그·조각", bytes: "4B", value: SKIP },
      { name: "TTL", bytes: "1B", value: ipv4.ttl },
      { name: "프로토콜", bytes: "1B", value: protocol === undefined ? SKIP : `${protocol} (${inner})` },
      { name: "헤더 체크섬", bytes: "2B", value: SKIP },
      { name: "출발 주소", bytes: "4B", value: ipv4.sourceIp },
      { name: "도착 주소", bytes: "4B", value: ipv4.destinationIp },
    ]} payload={inner} />
  );
}

/** 프레임을 헤더 해부도로 펼친다. 바깥 Ethernet부터 안쪽 페이로드까지 */
export function PacketStructure({ frame }: { readonly frame: FrameSnapshot }) {
  const { ethernet, arp, ipv4, icmp, udp, tcp, rip, application, gre, esp } = frame;
  const sections: ReactNode[] = [];

  // L2 — Ethernet II는 헤더 14B + VLAN 태그가 있으면 4B
  const etherType = arp !== undefined ? "0x0806 (ARP)" : ipv4 !== undefined ? "0x0800 (IPv4)" : SKIP;
  const ethFields: Field[] = [
    { name: "도착 주소", bytes: "6B", value: ethernet.destinationMac },
    { name: "출발 주소", bytes: "6B", value: ethernet.sourceMac },
    ...(ethernet.vlanTag === undefined ? [] : [
      { name: "802.1Q TPID", bytes: "2B", value: "0x8100" } satisfies Field,
      { name: "802.1Q TCI (VLAN)", bytes: "2B", value: `VLAN ${ethernet.vlanTag}` } satisfies Field,
    ]),
    { name: "EtherType", bytes: "2B", value: etherType },
  ];
  const l2Payload = arp !== undefined ? "ARP" : ipv4 !== undefined ? "IPv4" : undefined;
  sections.push(<Section key="eth" title={`Ethernet II 헤더${ethernet.vlanTag === undefined ? "" : " + 802.1Q 태그"}`}
    bytes={`${14 + (ethernet.vlanTag === undefined ? 0 : 4)} 바이트`} fields={ethFields} payload={l2Payload} />);

  if (arp !== undefined) {
    sections.push(<Section key="arp" title="ARP" bytes="28 바이트" fields={[
      { name: "하드웨어 종류", bytes: "2B", value: "1 (Ethernet)" },
      { name: "프로토콜 종류", bytes: "2B", value: "0x0800 (IPv4)" },
      { name: "하드웨어·프로토콜 길이", bytes: "2B", value: "6 · 4" },
      { name: "연산", bytes: "2B", value: `${arp.operation === "request" ? 1 : 2} (${arp.operation})` },
      { name: "보낸 MAC", bytes: "6B", value: arp.senderMac },
      { name: "보낸 IP", bytes: "4B", value: arp.senderIp },
      { name: "받는 MAC", bytes: "6B", value: arp.targetMac },
      { name: "받는 IP", bytes: "4B", value: arp.targetIp },
    ]} />);
  }

  // L3 — 외부 IPv4. 안쪽은 GRE·ESP 페이로드거나 TCP/UDP/ICMP다
  const tunnel = gre ?? esp;
  const l3Inner = tunnel !== undefined ? (gre !== undefined ? "GRE" : "ESP")
    : icmp !== undefined ? "ICMP" : tcp !== undefined ? "TCP" : udp !== undefined ? "UDP" : undefined;
  const l3Proto = l3Inner === undefined ? undefined
    : ({ ICMP: 1, TCP: 6, UDP: 17, GRE: 47, ESP: 50 } as const)[l3Inner];
  if (ipv4 !== undefined) sections.push(ipv4Section("IPv4 헤더", ipv4, l3Proto, l3Inner));

  if (gre !== undefined) {
    sections.push(<Section key="gre" title="GRE 헤더" bytes="4 바이트" fields={[
      { name: "플래그·버전", bytes: "2B", value: "0" },
      { name: "프로토콜 종류", bytes: "2B", value: "0x0800 (IPv4)" },
    ]} payload="안쪽 IPv4" />);
  }
  if (esp !== undefined) {
    sections.push(<Section key="esp" title="ESP 헤더" bytes="8 바이트" fields={[
      { name: "SPI", bytes: "4B", value: `0x${esp.spi.toString(16)}` },
      { name: "순번", bytes: "4B", value: esp.sequence },
      { name: "비고", bytes: "", value: "암호화 없는 교육용 모델" },
    ]} payload="안쪽 IPv4" />);
  }
  if (tunnel !== undefined) {
    sections.push(ipv4Section("안쪽 IPv4 헤더", tunnel.payload.ipv4, 1, "ICMP"));
    sections.push(<Section key="icmp-in" title="ICMP" bytes="4 바이트 + 데이터" fields={icmpFields(tunnel.payload.icmp)} />);
  }

  if (icmp !== undefined && tunnel === undefined) {
    sections.push(<Section key="icmp" title="ICMP" bytes="4 바이트 + 데이터" fields={icmpFields(icmp)} />);
  }

  // L4
  if (tcp !== undefined) {
    const flagText = tcp.flags.replace("-", "+");
    sections.push(<Section key="tcp" title="TCP 헤더" bytes="20 바이트" fields={[
      { name: "출발 포트", bytes: "2B", value: tcp.sourcePort },
      { name: "도착 포트", bytes: "2B", value: tcp.destinationPort },
      { name: "순서·확인 번호", bytes: "8B", value: SKIP },
      { name: "데이터 오프셋·예약", bytes: "1B", value: "5" },
      { name: "플래그", bytes: "1B", value: flagText },
      { name: "창 크기", bytes: "2B", value: SKIP },
      { name: "체크섬·긴급 포인터", bytes: "4B", value: SKIP },
    ]} payload={application === undefined && rip === undefined ? undefined : "응용 데이터"} />);
  }
  if (udp !== undefined) {
    sections.push(<Section key="udp" title="UDP 헤더" bytes="8 바이트" fields={[
      { name: "출발 포트", bytes: "2B", value: udp.sourcePort },
      { name: "도착 포트", bytes: "2B", value: udp.destinationPort },
      { name: "길이", bytes: "2B", value: SKIP },
      { name: "체크섬", bytes: "2B", value: SKIP },
    ]} payload={rip !== undefined || application !== undefined ? "응용 데이터" : undefined} />);
  }

  // L7
  if (rip !== undefined) {
    sections.push(<Section key="rip" title="RIP 메시지" bytes="4 바이트 + 항목" fields={[
      { name: "명령", bytes: "1B", value: rip.command },
      { name: "버전", bytes: "1B", value: 2 },
      { name: "경로 항목", bytes: "20B × N", value: rip.entries.length === 0 ? "없음"
        : rip.entries.map(entry => `${entry.network}/${entry.mask} 거리 ${entry.metric}`).join(" · ") },
    ]} />);
  }
  if (application !== undefined) {
    sections.push(<Section key="app" title={`응용 데이터 (${application.service.toUpperCase()})`} bytes="페이로드" fields={[
      { name: "내용", bytes: "", value: application.message },
      ...(application.data === undefined ? [] : [{ name: "본문", bytes: "", value: application.data } satisfies Field]),
    ]} />);
  }

  return <div className="pkt-structure">{sections}</div>;
}
