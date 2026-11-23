# 리눅스 네이티브 라우터 구현 계획

- 작성 2026-11-24. 담당 jarrod. 팀 합의 전 초안.
- 기준 코드: feat/T0.22-local-dev-setup (`main` + 1커밋).
- **이번 범위: Router의 세 번째 CLI 스타일 `linux`. 리눅스 셸·`ip` 명령·`sysctl ip_forward`·`iptables -t filter|nat`과 NAT 실제 동작까지.**

## 배경

서버 PC의 `iptables`는 filter 테이블만 다루고, 서버가 패킷을 전달하지 않아 `-t nat`를 넣어도 걸릴 패킷이 없다.
NAT는 경로 장비의 일이라, 라우터에 리눅스 네이티브 콘솔을 얹으면 `iptables -t nat`가 실제로 의미를 갖는다.
원래 요구사항 목록(00 문서 0.5절)에 있던 NAT이 이 작업으로 처음 구현된다.

## 구현 순서

| 순서 | 작업 | Task | 검증 |
|---|---|---|---|
| 1 | `cliStyle: "linux"` 뼈대: 스키마·전환 명령·콘솔 분기·`ip` 명령·UI 옵션 | T16.1.x | Linux 콘솔에서 주소·경로 보기와 설정, 포트 끄기 |
| 2 | 라우터용 iptables 모델과 CLI (filter + nat 저장·보기), `-t` 표시 | T16.2.x | `-S`/`-L` 출력, FORWARD 체인에 규칙을 넣고 지나가는 패킷 |
| 3 | NAT 실제 동작: SNAT/MASQUERADE·DNAT + conntrack | T16.3.x | 사설 PC가 공인 쪽 서버로 나갈 때 출발지 변환과 응답 복원 |
| 4 | 화면: 라우터 iptables 구역, 안내 문서, `-t` 표시 정리 | T16.4.x | 브라우저 확인, 회귀 |

단계마다 작업 기록(`docs/task-logs/`)과 검증을 남긴다. Task 번호 T16.x는 새 Epic 번호로 팀 합의가 필요하다.

## T16.1 리눅스 콘솔의 계약

- `RouterConfig.cliStyle`에 `"linux"`를 더한다. `router/set-cli-style`과 화면의 스타일 선택이 `ios | vyos | linux` 셋을 받는다.
- 프롬프트는 `root@<장비 이름>:~#`. VyOS처럼 별도 설정 모드는 없다.
- 물리 포트 `GigabitEthernet0/0`~`0/3`은 콘솔에서 `eth0`~`eth3`으로 보인다. 문서의 포트 이름은 바꾸지 않는다.
- 첫 명령 집합: `ip addr [add|del]`, `ip link [set up|down]`, `ip route [add|del|show]`, `ip neigh`, `ping`, `traceroute`, `sysctl net.ipv4.ip_forward`, `hostname`, `iptables` (T16.2에서 채움).
- 설정 변경은 PC·IOS 콘솔과 같은 `dispatch` 경로로 Document를 바꾼다 (AD-3). 세션 상태는 모드 전환 시 지운다 (기존 `sessions.delete` 로직).
- `sysctl net.ipv4.ip_forward`는 `RouterConfig.ipForward`(기본값 true)를 바꾼다. 끄면 전달이 멈춰 라우터 뒤 LAN이 끊긴다 — "ip_forward를 잊은" 전형적 실패를 실습할 수 있다. 기본값을 실제 리눅스처럼 0으로 둘지(교육상 솔직, 기존 문서와 다른 기본 동작)는 팀 확인 사항이다.

## T16.2 라우터 iptables의 계약

- `RouterConfig`에 테이블별 규칙을 둔다: `filter`(INPUT·FORWARD·OUTPUT)와 `nat`(PREROUTING·POSTROUTING·OUTPUT). 체인 구조가 달라 서버 PC의 `PcFilter`를 재사용하지 않고 새 타입을 둔다.
- `-t` 옵션: `filter`(기본)과 `nat`을 받는다. `mangle`·`raw`는 "PING9은 filter와 nat만 다룬다"는 안내 오류.
- filter의 FORWARD 체인이 처음으로 실제로 작동한다 — 라우터를 지나는 패킷이 규칙과 정책을 만난다. INPUT은 라우터 자신이 받는 것(자기 주소로 온 ping 등), OUTPUT은 라우터가 내는 것(RIP 교환 등은 제외할지 팀 확인).
- `-t` 표시: `-S`는 각 줄에 `-t <table>`을 붙이고, `-L`은 `Table: <table>` 줄을 앞에 둔다(실제 iptables는 안 보이지만 교육용 명시). `iptables -h`에 `[-t table]`와 지원 테이블을 적는다.
- 서버 PC 쪽 `-t` 표시(-S/-L/패널/도움말)도 같은 규칙으로 정리한다. 서버는 filter만이라 `-t filter`만 나온다.

## T16.3 NAT의 계약

- `nat POSTROUTING -o ethN -j MASQUERADE|SNAT --to <주소>`: 나가는 패킷의 출발지를 바꾼다.
- `nat PREROUTING -i ethN -j DNAT --to-destination <주소>`: 들어오는 패킷의 목적지를 바꾼다 (포트 포워딩).
- 응답 패킷은 런타임의 conntrack 상태가 거꾸로 변환한다. conntrack은 Document가 아니라 Runtime에 둔다 (배운 상태는 저장하지 않는다는 기존 결정과 같음).
- 변환은 전달 경로(`devices/router/routing.ts`)의 출력 단계에서 일어난다. Trace에는 변환 전후 주소가 보여 화면 재생에서 확인할 수 있다.
- 교육용 단순화: ICMP echo와 UDP/TCP 서비스 흐름만 추적한다. 포트 변환(NAPT 포트 충돌), ALG, fragmented 패킷은 범위 밖.
- `conntrack -L`로 추적 중인 연결을 보이거나, `iptables -t nat -L -v`에 카운터를 둔다. 어느 쪽인지 구현 단계에서 정한다.

## T16.4 화면의 계약

- 라우터 속성 패널에 iptables 구역: 테이블별 규칙을 `iptables -t <table> -A <chain> <spec>` 전체 명령 형태로 보인다. 서버 패널의 규칙 줄도 같은 형태로 맞춘다.
- 스타일 선택은 기존 위치(`vpn-settings.tsx`의 select)에 `linux`를 얹는다. 라벨은 팀과 맞춘다 (예: "Linux").

## 검증 구성

```text
PC_A — R1(linux) — R2(ISP) — SRV
```

| 구간 | 주소 |
|---|---|
| LAN A | PC_A 192.168.10.10/24, R1 eth0 192.168.10.1 |
| R1—R2 | R1 eth1 203.0.113.1/30, R2 203.0.113.2/30 |
| 서버 쪽 | R2 다른 포트 198.51.100.1/30, SRV 198.51.100.2 |
| NAT | R1 `iptables -t nat -A POSTROUTING -o eth1 -j MASQUERADE` |

ISP(R2)에는 사설망 경로를 넣지 않는다. NAT 없이 우연히 통과하는 것을 막고, SRV가 보는 출발지가 R1의 공인 주소인지 확인한다.

## 완료 조건

- 설정 검증·CLI·JSON 저장/복원·옛 문서 호환 자동 테스트.
- MASQUERADE로 나간 ping의 출발지 변환과 응답 복원, DNAT 포트 포워딩, `ip_forward` 끄기 실패.
- FORWARD 체인 DROP/REJECT가 통과 패킷에 적용됨.
- PC/Switch/Static/RIP/VPN/기존 서버 iptables 회귀 검사.
- `pnpm check`, `pnpm check:secrets`, 브라우저 확인 및 PR/팀원 리뷰.

## 범위 밖

- nftables, firewalld, ip rule·여러 라우팅 테이블, bridge, IPv6.
- mangle·raw 테이블. 마킹·QoS 개념이 시뮬레이터에 없다.
- NAT 포트 충돌(NAPT), ALG(FTP 등), 단편화.
- VyOS 스타일의 NAT 문법 (`set nat ...`). VyOS는 VPN 부분집합으로 둔다.
