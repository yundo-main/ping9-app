// 앱 사용법을 보여 주는 도움말 창 (T0.30). 상단 막대의 ? 버튼으로 열고,
// 닫기 버튼·Esc·바깥 클릭으로 닫는다. 내용은 실제 구현된 기능만 적는다.

import { useEffect, useRef } from "react";

const SECTIONS: readonly { readonly title: string; readonly items: readonly (readonly [string, string])[] }[] = [
  {
    title: "시작하기",
    items: [
      ["장비 놓기", "왼쪽 목록에서 PC·서버·스위치·L3 스위치·허브·라우터·LB를 캔버스로 끌어 놓습니다"],
      ["케이블 연결", "왼쪽의 🔗 버튼을 누르고 장비 두 대를 차례로 눌러 포트를 고릅니다"],
      ["장비 설정", "장비를 누르면 오른쪽 패널에서 이름·IP 주소·게이트웨이를 고칩니다"],
      ["콘솔 열기", "장비를 두 번 누르거나 선택 뒤 Enter를 누릅니다"],
    ],
  },
  {
    title: "PC·서버 콘솔",
    items: [
      ["ip address / ip route", "주소와 게이트웨이를 보거나 바꿉니다"],
      ["ping <주소>", "목표까지 닿는지 확인합니다"],
      ["nslookup / curl", "서버의 DNS·HTTP 서비스에 요청합니다 (server 장비에서 services 켜기)"],
    ],
  },
  {
    title: "라우터·스위치 콘솔 (Cisco IOS)",
    items: [
      ["enable → configure terminal", "설정 모드로 들어갑니다"],
      ["ip address <주소> <마스크>", "인터페이스에 주소를 줍니다"],
      ["ip route / router rip", "정적 경로와 RIP 경로 교환"],
      ["ip nat inside · outside", "인터페이스에 NAT 방향을 표시합니다"],
      ["ip nat pool / inside source list", "동적 NAT와 overload(PAT). access-list로 출발지를 가릅니다"],
      ["ip nat inside source static", "외부에서 내부 호스트로 오는 고정 대응"],
      ["show ip nat translations", "현재 변환 바인딩 표를 봅니다"],
      ["show vlan brief", "스위치의 VLAN 표를 봅니다"],
    ],
  },
  {
    title: "L3 스위치 콘솔",
    items: [
      ["ip routing", "VLAN 간 라우팅을 켭니다 (configure terminal 안)"],
      ["interface vlan <번호>", "SVI를 만들어 ip address로 게이트웨이를 줍니다"],
      ["no switchport", "포트를 라우티드 포트로 바꿉니다"],
      ["ip route / router rip", "정적 경로와 RIP — 라우터와 같습니다"],
    ],
  },
  {
    title: "LB 콘솔 (리눅스)",
    items: [
      ["프런트엔드", "속성 패널에서 받을 포트·모드(L4 TCP/L7 HTTP)·백엔드(ip:포트·weight)를 고릅니다"],
      ["L4 vs L7", "L4는 DNAT 전달, L7은 LB가 TCP를 맺는 프록시 — 경로 접두로 백엔드를 고릅니다"],
      ["ip addr / ip route / ping", "리눅스 명령으로 주소·경로·통신을 봅니다"],
      ["haproxy -c", "설정된 listen·server 목록을 봅니다"],
      ["토폴로지 조건", "백엔드는 LB 뒤 세그먼트에 두고 게이트웨이를 LB로 잡습니다"],
    ],
  },
  {
    title: "콘솔 스타일",
    items: [
      ["linux", "라우터 속성에서 고를 수 있습니다. ip addr·ip route·iptables -t nat을 씁니다 (LB는 항상 리눅스)"],
      ["vyos", "set nat source rule ..., commit, show configuration commands"],
    ],
  },
  {
    title: "시뮬레이션 모드",
    items: [
      ["⏯ 시뮬레이션 탭", "패킷이 걸어 다니는 것을 재생으로 봅니다. 멈춤·속도 조절 가능"],
      ["펭귄(패킷) 누르기", "패킷 카드가 열려 경유지·NAT 변환·실패 원인을 보입니다"],
      ["이벤트 패널", "오른쪽에서 시간순 이벤트를 봅니다. 이벤트를 누르면 위치가 빛납니다"],
    ],
  },
  {
    title: "단축키",
    items: [
      ["Enter", "선택한 장비의 콘솔을 엽니다"],
      ["Shift+드래그", "빈 곳에서 끌어 여러 장비·케이블을 함께 고릅니다"],
      ["⌘/Ctrl+누르기", "고른 묶음에서 장비·케이블을 빼거나 넣습니다"],
      ["Delete / Backspace", "선택한 장비·케이블을 지웁니다"],
      ["Esc", "케이블 도구·드래그·확인 창을 해제합니다"],
      ["? (터미널 안)", "그 장비의 명령 도움말을 봅니다"],
      ["Tab (터미널 안)", "명령을 자동 완성합니다"],
    ],
  },
];

export function HelpDialog({ onClose, onAbout }: { readonly onClose: () => void; readonly onAbout?: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  // 열리면 닫기 버튼으로 — Enter나 Space로 바로 닫을 수 있다
  useEffect(() => close.current?.focus(), []);
  return (
    <div className="confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div className="help-head">
          <strong id="help-title">PING9 도움말</strong>
          <button ref={close} type="button" aria-label="도움말 닫기" onClick={onClose}>×</button>
        </div>
        <div className="help-body">
          {SECTIONS.map((section) => (
            <section key={section.title} className="help-section">
              <h3>{section.title}</h3>
              <dl>
                {section.items.map(([term, desc]) => (
                  <div key={term} className="help-row">
                    <dt>{term}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        {onAbout !== undefined && (
          <div className="help-foot">
            <button type="button" className="about-link" onClick={onAbout}>PING9에 관하여</button>
          </div>
        )}
      </div>
    </div>
  );
}
