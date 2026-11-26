// N1 네트워크 기초 — 첫 레슨. 장비는 배치·연결돼 있고 주소만 비어 있다.
// 학생은 인스펙터 또는 콘솔로 PC 두 대에 같은 서브넷의 주소를 주고 ping을 성공시킨다.

import { defineLesson } from "../lesson";

export const n1FirstPing = defineLesson({
  id: "n1-first-ping",
  unit: "n1-basics",
  order: 1,
  title: "첫 ping — PC 두 대를 연결하기",
  brief: [
    "PC1과 PC2가 스위치로 연결돼 있지만 아직 주소가 없습니다.",
    "",
    "1. PC1의 Ethernet0에 `192.168.1.10`, 마스크 `255.255.255.0`을 설정하세요",
    "2. PC2의 Ethernet0에 `192.168.1.20`, 마스크 `255.255.255.0`을 설정하세요",
    "3. PC1 콘솔에서 `ping 192.168.1.20`으로 확인하세요",
    "",
    "추적 패널에서 ARP 요청→응답이 지나가는 것도 관찰해 보세요.",
  ].join("\n"),
  startDocument: {
    schemaVersion: 1,
    devices: [
      { id: "11111111-1111-4111-8111-111111111111", kind: "pc", name: "PC1", position: { x: 160, y: 220 }, config: {} },
      { id: "22222222-2222-4222-8222-222222222222", kind: "switch", name: "SW1", position: { x: 320, y: 220 },
        config: { vlans: [{ id: 1, name: "default" }], ports: {} } },
      { id: "33333333-3333-4333-8333-333333333333", kind: "pc", name: "PC2", position: { x: 480, y: 220 }, config: {} },
    ],
    links: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", ends: [{ deviceId: "11111111-1111-4111-8111-111111111111", port: "Ethernet0" }, { deviceId: "22222222-2222-4222-8222-222222222222", port: "FastEthernet0/1" }] },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", ends: [{ deviceId: "33333333-3333-4333-8333-333333333333", port: "Ethernet0" }, { deviceId: "22222222-2222-4222-8222-222222222222", port: "FastEthernet0/2" }] },
    ],
  },
  checks: [
    { kind: "ip", device: "PC1", port: "Ethernet0", ip: "192.168.1.10", mask: "255.255.255.0" },
    { kind: "ip", device: "PC2", port: "Ethernet0", ip: "192.168.1.20", mask: "255.255.255.0" },
    { kind: "trace", code: "ARP_REQUEST_SENT" },
    { kind: "ping", from: "PC1", to: "192.168.1.20" },
  ],
});
