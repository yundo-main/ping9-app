// 편집기 화면. 배치는 화면 시안을 따른다: 상단 막대, 왼쪽 장비 목록, 가운데 캔버스, 오른쪽 속성 패널.
// 화면이 가진 상태는 선택, 열린 터미널, 터미널의 화면 기록뿐이다. 나머지는 engine의 스냅샷에서 읽는다 (AD-4).

import { EMPTY_DOCUMENT, errorInfo, osOf, pingRoundKind, shortPortName } from "@ping9/shared";
import type { ErrorInfo, PortRef, Position, TopologyDocument } from "@ping9/shared";
import type { PaletteKind } from "./canvas-interaction";
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Canvas, cableLength } from "./components/canvas";
import { ConfirmDialog } from "./components/confirm-dialog";
import { HelpDialog } from "./components/help-dialog";
import { AboutDialog } from "./components/about-dialog";
import { CloudInsideDialog } from "./components/cloud-inside-dialog";
import { EventPanel, highlightOf, SideTabs } from "./components/event-panel";
import type { SideTab } from "./components/event-panel";
import { isRemoveKey, removeKeyAction } from "./components/canvas-keys";
import { Inspector } from "./components/inspector";
import { LinkInspector } from "./components/link-inspector";
import { Palette } from "./components/palette";
import { useSideWidth } from "./components/side-resize";
import { PacketCard } from "./components/packet-card";
import type { PenguinPick, Replay } from "./components/packet-layer";
import { TerminalWindow } from "./components/terminal-window";
import { focusCanvasNode, focusTerminalInput } from "./focus";
import { TopBar } from "./components/top-bar";
import { CABLE_OFF, CABLE_READY, syncCableState } from "./cable-state";
import type { CableState } from "./cable-state";
import { cardStillShown, createCardPause } from "./card-pause";
import type { DragCancelState } from "./canvas-interaction";
import { availablePorts } from "./format/available-ports";
import { formatError } from "./messages/errors";
import { browserStorage, readMode, writeMode } from "./mode";
import type { Mode } from "./mode";
import { exchangeTimeline, previewTimeline } from "./replay/timeline";
import { BROWSER_TIME, createSimClock } from "./sim-clock";
import { TOPOLOGY_NAME, simulator, useSnapshot } from "./simulator";
import { browserDownload, exportFile, importNameOf, needsReplaceConfirm, readImportFile } from "./topology-file";
import { createCommandQueue } from "./terminal/command-queue";
import { completed, historyStep, initialTerminal, refreshPrompts, runLinePaced, showCandidates, showHelp } from "./terminal/terminal-state";
import type { TerminalState } from "./terminal/terminal-state";
import { INITIAL_UI_STATE, uiReducer } from "./ui-state";

type Terminals = Readonly<Record<string, TerminalState>>;

const KIND_LABEL: Readonly<Record<PaletteKind, "PC" | "Server" | "L2 Switch" | "Router" | "Hub" | "L3 Switch" | "LB" | "Cloud">> = {
  pc: "PC",
  server: "Server",
  switch: "L2 Switch",
  router: "Router",
  hub: "Hub",
  l3switch: "L3 Switch",
  lb: "LB",
  cloud: "Cloud",
};

/** 시안에서 터미널 창이 쌓이기 시작하는 z-index */
const TERMINAL_Z = 20;
/** 가져올 파일을 고르고 바꾸기를 묻는 중인 것 (T7.1.2) */
interface PendingImport {
  /** 파일에서 왔으면 그 이름, 새 토폴로지면 null (대화상자 문구가 달라진다) */
  readonly fileName: string | null;
  readonly name: string;
  readonly document: TopologyDocument;
}

/** 경로 교환 재생의 열쇠. 장비 ID(UUID)와 겹치지 않는다 (T11.5.1) */
const RIP_REPLAY_KEY = "rip";

/** 데스크톱 앱이 파일 메뉴 이벤트로 부르는 동작들 (T0.40, E3.0) */
export interface MenuActions {
  readonly exportTopology: () => void;
  readonly importTopology: (file: File) => Promise<void>;
  readonly newTopology: () => void;
  readonly openAbout: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

/** 셸이 끄고 켤 수 있는 화면 기능 (E6.4). 빠진 항목은 켜진 것으로 본다 */
export interface EditorFeatures {
  /** 상단 막대의 내보내기·가져오기 버튼. false면 그리지 않는다 */
  readonly fileActions?: boolean;
}

export interface EditorAppProps {
  /** 파일 저장 — 없으면 브라우저 다운로드. Tauri 앱은 저장 창 구현을 넘긴다 */
  readonly download?: (fileName: string, text: string) => Promise<void>;
  /** 데스크톱 메뉴 액션을 받을 콜백. 브라우저는 넘기지 않는다 */
  readonly onActions?: (actions: MenuActions) => void;
  /** 화면 기능 스위치 — edu 같은 임베디드 셸이 본체 UI의 일부를 끌 때 쓴다 */
  readonly features?: EditorFeatures | undefined;
}

export function EditorApp({ download, onActions, features }: EditorAppProps) {
  const snapshot = useSnapshot();
  const { document } = snapshot;
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const [actionError, setActionError] = useState<ErrorInfo | null>(null);
  // 토폴로지 이름. 서버가 없어 처음은 고정 이름이고, 가져온 파일의 이름으로 바뀐다 (T7.1.2)
  const [topologyName, setTopologyName] = useState(TOPOLOGY_NAME);
  // 가져온 파일의 이름 (T0.61). 새 토폴로지면 null
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [importAsk, setImportAsk] = useState<PendingImport | null>(null);
  // 가져오기 실패. 닫을 때까지 보인다 (FR-45)
  const [importError, setImportError] = useState<ErrorInfo | null>(null);
  const [cable, setCable] = useState<CableState>(CABLE_OFF);
  // 선택 도구: 켜져 있으면 빈 곳 드래그가 범위 선택이 된다 (T0.43). 케이블 도구와 같이 켜지지 않는다
  const [selectActive, setSelectActive] = useState(false);
  const [dragKind, setDragKind] = useState<PaletteKind | null>(null);
  // 끄는 라우터의 CLI 형식 (T0.52). 라우터가 아니면 무의미
  const [dragCliStyle, setDragCliStyle] = useState<"ios" | "vyos" | "linux">("ios");
  // 오른쪽 패널 폭. 손잡이로 끌어 바꾼다 (T0.18)
  const side = useSideWidth();
  // 목록에서 끌어 온 새 장비를 왼쪽 장비 목록에 다시 놓으면 취소된다 (T0.12). 캔버스가 목록의 자리를 보고 상태를 알려 준다
  const paletteRef = useRef<HTMLElement>(null);
  const [dragCancel, setDragCancel] = useState<DragCancelState>("idle");
  // 케이블이 연결된 장비를 지우기 전에 한 번 더 묻는 중인 장비 (T1.4.3)
  const [removeAsk, setRemoveAsk] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [cloudInside, setCloudInside] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const selectedLink = document.links.find(link => link.id === selectedLinkId);
  // 범위 선택(Shift+드래그)으로 고른 장비·케이블 (T0.42). 하나만 걸리면 평소 선택이 된다
  const EMPTY_SEL: { readonly devices: readonly string[]; readonly links: readonly string[] } = { devices: [], links: [] };
  const [boxSel, setBoxSel] = useState(EMPTY_SEL);
  const boxSelCount = boxSel.devices.length + boxSel.links.length;
  const [multiAsk, setMultiAsk] = useState(false);

  const addDevice = (kind: PaletteKind, position: Position) => {
    setDragKind(null);
    const id = crypto.randomUUID();
    const result = simulator.dispatch({ type: "device/add", id, kind, position });
    // 라우터는 팔레트 플라이아웃에서 고른 CLI 형식을 바로 넣는다 (T0.52). 기본 ios는 저장하지 않는다
    const styled = result.ok && kind === "router" && dragCliStyle !== "ios"
      ? simulator.dispatch({ type: "router/set-cli-style", deviceId: id, style: dragCliStyle })
      : result;
    setActionError(styled.ok ? null : styled.error);
    if (result.ok && styled.ok) {
      setBoxSel(EMPTY_SEL);
      setSelectedLinkId(null);
      dispatch({ type: "select", deviceId: id });
    }
  };

  const pickPort = (end: PortRef) => {
    const current = simulator.getSnapshot().document;
    if (!availablePorts(current, end.deviceId).includes(end.port)) {
      setActionError({ code: "PORT_IN_USE", params: end });
      return;
    }
    const synced = syncCableState(cable, current);
    if (synced.first !== cable.first) {
      setCable(synced);
      if (cable.first !== null) setActionError({ code: "PORT_IN_USE", params: cable.first });
      return;
    }
    if (cable.first === null) {
      setCable({ active: true, first: end, pickerDeviceId: null });
      setActionError(null);
      setConnectionMessage(null);
      return;
    }
    if (cable.first.deviceId === end.deviceId) return;
    const id = crypto.randomUUID();
    const result = simulator.dispatch({ type: "link/add", id, ends: [cable.first, end] });
    if (result.ok) {
      setCable(CABLE_READY);
      setSelectedLinkId(id);
      setActionError(null);
      setConnectionMessage("케이블을 연결했어요. 다음 장비를 선택하거나 Esc로 도구를 해제하세요");
      dispatch({ type: "select", deviceId: null });
    } else setActionError(result.error);
  };

  const selectDevice = (deviceId: string) => {
    setBoxSel(EMPTY_SEL);
    setSelectedLinkId(null);
    setActionError(null);
    setConnectionMessage(null);
    dispatch({ type: "select", deviceId });
    if (cable.active) setCable(current => ({ ...current, pickerDeviceId: deviceId }));
  };

  const selectLink = (linkId: string) => {
    setBoxSel(EMPTY_SEL);
    setSelectedLinkId(linkId);
    setCable(current => ({ ...current, pickerDeviceId: null }));
    dispatch({ type: "select", deviceId: null });
  };

  /**
   * 캔버스는 끌기를 위해 누르기의 기본 동작을 막아서, 눌러도 포커스가 전에 있던 곳에 남는다 (T1.3.3).
   * 속성 패널의 입력은 캔버스 어디를 눌러도 끝낸다 (이름 입력란은 벗어날 때 적용한다).
   * 장비나 케이블을 누르면 터미널 입력란이나 다른 장비에 있던 포커스도 뗀다. 안 그러면 Delete가 방금 고른 것에 닿지 않는다
   */
  const releaseFocus = (event: ReactPointerEvent<HTMLElement>) => {
    const active = window.document.activeElement;
    if (!(active instanceof HTMLElement || active instanceof SVGElement) || active === window.document.body) return;
    const pressed = event.target instanceof Element ? event.target.closest("g.node, g.link") : null;
    if (active.closest(".inspector") !== null || (pressed !== null && !pressed.contains(active))) active.blur();
  };

  const moveDevice = (deviceId: string, position: Position) => {
    const result = simulator.dispatch({ type: "device/move", deviceId, position });
    setActionError(result.ok ? null : result.error);
    if (result.ok) {
      setSelectedLinkId(null);
      dispatch({ type: "select", deviceId });
    }
  };

  const removeSelectedLink = () => {
    if (selectedLink === undefined) return;
    const result = simulator.dispatch({ type: "link/remove", linkId: selectedLink.id });
    setActionError(result.ok ? null : result.error);
    if (result.ok) { setBoxSel(EMPTY_SEL); setSelectedLinkId(null); }
  };

  // 범위 선택 결과를 상태에 담는다. 하나만 걸리면 평소 하나 고르기와 같다 (T0.42)
  const applyBoxSelection = (devices: readonly string[], links: readonly string[]) => {
    if (devices.length === 1 && links.length === 0 && devices[0] !== undefined) return selectDevice(devices[0]);
    if (devices.length === 0 && links.length === 1 && links[0] !== undefined) return selectLink(links[0]);
    setSelectedLinkId(null);
    dispatch({ type: "select", deviceId: null });
    setBoxSel(devices.length === 0 && links.length === 0 ? EMPTY_SEL : { devices, links });
  };

  // ⌘/Ctrl/Shift+누르기는 고른 묶음에서 빼거나 넣는다. 묶음이 비면 지금 고른 하나를 심는다
  const toggleSelection = (deviceId: string | null, linkId: string | null) => {
    const devices = new Set(boxSel.devices);
    const links = new Set(boxSel.links);
    if (devices.size + links.size === 0) {
      if (ui.selectedDeviceId !== null) devices.add(ui.selectedDeviceId);
      if (selectedLinkId !== null) links.add(selectedLinkId);
    }
    if (deviceId !== null) { if (devices.has(deviceId)) devices.delete(deviceId); else devices.add(deviceId); }
    if (linkId !== null) { if (links.has(linkId)) links.delete(linkId); else links.add(linkId); }
    applyBoxSelection([...devices], [...links]);
  };

  // 장비별 터미널의 화면 기록. 창을 닫았다 열어도 남는다 (FR-19).
  // 실행이 비동기라 가장 최근 값을 ref에 두고, 바꿀 때는 항상 updateTerminals를 거친다
  const [terminals, setTerminals] = useState<Terminals>({});
  const latest = useRef<Terminals>({});
  const updateTerminals = (change: (current: Terminals) => Terminals) => {
    latest.current = change(latest.current);
    setTerminals(latest.current);
  };

  // 장비마다 앞 명령의 실행이 끝난 뒤에 다음 명령을 실행한다. 줄의 순서가 입력 순서와 같게 된다.
  // 실행이 실패해도 그 터미널이 멈추지 않게, 실패는 그 터미널에 오류 줄로 남긴다
  const [queue] = useState(() =>
    createCommandQueue((deviceId) => {
      updateTerminals((current) => {
        const state = current[deviceId];
        if (state === undefined) return current;
        const failed: TerminalState = {
          ...state,
          lines: [...state.lines, { kind: "error", text: "명령을 실행하지 못했어요. 다시 입력해 주세요" }],
        };
        return { ...current, [deviceId]: failed };
      });
    }),
  );

  // 문서에서 사라진 장비를 가리키는 선택과 터미널을 비운다. 지운 장비의 화면 기록도 버린다 (T1.3.3).
  // 남은 터미널의 프롬프트는 지금 문서의 것으로 맞춘다 (OS나 이름이 바뀌었을 때, T0.7)
  useEffect(() => {
    const alive = new Set(document.devices.map((device) => device.id));
    dispatch({ type: "sync", deviceIds: [...alive] });
    updateTerminals((current) => refreshPrompts(
      Object.keys(current).every((deviceId) => alive.has(deviceId)) ? current
        : Object.fromEntries(Object.entries(current).filter(([deviceId]) => alive.has(deviceId))),
      (deviceId) => simulator.console(deviceId).prompt()));
    setSelectedLinkId(current => document.links.some(link => link.id === current) ? current : null);
    setCable(current => syncCableState(current, document));
    // 되돌리기·가져오기로 사라진 장비·케이블이 범위 선택에 남지 않게 정리한다 (T0.53)
    const linkIds = new Set(document.links.map(link => link.id));
    setBoxSel(current => {
      const devices = current.devices.filter(id => alive.has(id));
      const links = current.links.filter(id => linkIds.has(id));
      return devices.length === current.devices.length && links.length === current.links.length ? current : { devices, links };
    });
  }, [document]);

  // 메뉴가 없는 환경(개발용 브라우저)용 단축키. 앱에서는 메뉴의 ⌘Z·⇧⌘Z가 먼저 처리한다 (T0.53)
  useEffect(() => {
    const undoRedo = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      if (event.shiftKey) simulator.redo(); else simulator.undo();
    };
    window.addEventListener("keydown", undoRedo);
    return () => window.removeEventListener("keydown", undoRedo);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCable(CABLE_OFF); setDragKind(null); setConnectionMessage(null); setRemoveAsk(null); setImportAsk(null);
      setBoxSel(EMPTY_SEL); setMultiAsk(false); setSelectActive(false);
      setHelpOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  const openTerminal = (deviceId: string) => {
    setCable(CABLE_OFF);
    setSelectedLinkId(null);
    // 클라우드는 콘솔이 없다 — 두 번 누르면 내부 구조 창이 열린다 (T0.70)
    const picked = simulator.getSnapshot().document.devices.find((candidate) => candidate.id === deviceId);
    if (picked?.kind === "cloud") {
      setCloudInside(deviceId);
      dispatch({ type: "select", deviceId });
      return;
    }
    updateTerminals((current) =>
      current[deviceId] === undefined
        ? { ...current, [deviceId]: initialTerminal(simulator.console(deviceId).prompt()) }
        : current,
    );
    dispatch({ type: "select", deviceId });
    dispatch({ type: "open-terminal", deviceId });
    // 이미 열려 있던 창이어도 입력란으로 간다. 키보드로 콘솔을 오가는 길이다 (T1.6.2)
    focusTerminalInput(deviceId);
  };

  // 회차를 하나씩 보이는 중인 터미널. Ctrl+C가 이것을 멈춘다 (T1.8.3)
  const running = useRef(new Map<string, AbortController>());
  // 회차를 보이는 중인 장비. 그동안 입력 줄을 숨긴다
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const setBusyFor = (deviceId: string, value: boolean) =>
    setBusy((current) => {
      if (current.has(deviceId) === value) return current;
      const next = new Set(current);
      if (value) next.add(deviceId);
      else next.delete(deviceId);
      return next;
    });

  // 캔버스에서 재생 중인 ping 회차. 장비마다 하나다: 다음 회차나 다음 ping이 앞 것을 바꾼다 (T6.1.2).
  // 경로 교환 재생은 RIP_REPLAY_KEY로 하나다: 재생 버튼을 다시 누르면 처음부터 (T11.5.1).
  // 원인 폐기로 넘어진 펭귄은 재생이 끝나도 남고, 어느 장비에서든 다음 회차가 시작되거나 캔버스 빈 곳을 누르면 지운다
  const [replays, setReplays] = useState<ReadonlyMap<string, Replay>>(new Map());

  // 실시간 / 시뮬레이션 (T0.13). 펭귄은 시뮬레이션에서만 걷는다.
  // 진행 중인 ping은 회차마다 지금 모드를 읽는다(ref): 도중에 바꾸면 남은 회차가 새 모드를 따른다
  const [mode, setMode] = useState<Mode>(() => readMode(browserStorage()));
  // 시뮬레이션 시계 (T0.15). 시뮬레이션의 펭귄과 콘솔 줄 간격이 따른다. 멈추면 둘 다 서고, 속도를 바꾸면 둘 다 바뀐다
  const [clock] = useState(() => createSimClock(BROWSER_TIME));
  const clockState = useSyncExternalStore(clock.subscribe, clock.state, clock.state);
  const modeRef = useRef(mode);
  const changeMode = (next: Mode) => {
    if (next === modeRef.current) return;
    modeRef.current = next;
    setMode(next);
    writeMode(browserStorage(), next);
    // 실시간으로 바꾸면 걷던 펭귄과 남은 놓침 그림을 바로 지운다.
    // 멈춰 있었으면 풀어 준다: 멈춘 채 기다리던 ping이 실시간에서 서 있지 않게. 속도는 그대로 둔다
    if (next === "realtime") {
      setReplays(new Map());
      clock.resume();
    }
  };
  const replayList = useMemo(() => [...replays.values()], [replays]);

  // 오른쪽 패널의 상세 정보 / 이벤트 탭 (T1.9.2, 시뮬레이션 모드만). 탭은 사용자가 누를 때만 바뀐다
  const [sideTab, setSideTab] = useState<SideTab>("detail");
  // 이벤트 탭이 보여 줄 추적. null이면 마지막으로 재생을 시작한 ping을 따라간다
  const [pickedTrace, setPickedTrace] = useState<number | null>(null);
  const [lastPlayed, setLastPlayed] = useState<number | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  // 누른 펭귄 (T6.3.1). 누르면 시계를 멈추고 카드를 띄운다.
  // 카드가 내려갈 때는 어느 길이든 `cardPause.close()`를 지난다: 카드가 멈춘 시계만 다시 돌리고, 사용자가 멈춘 시계는 그대로 둔다
  const [picked, setPicked] = useState<PenguinPick | null>(null);
  const [cardPause] = useState(() => createCardPause(clock));
  const eventOf = (pick: PenguinPick) => (pick.traceId === undefined ? undefined : simulator.getTrace(pick.traceId)?.events[pick.seq]);
  const pickedEvent = picked === null ? undefined : eventOf(picked);
  const closeCard = () => { setPicked(null); cardPause.close(); };
  const hasPickedEvent = pickedEvent !== undefined;
  useEffect(() => {
    if (picked === null) return;
    // 사용자가 "다시 실행"을 눌렀거나(시계가 돈다), 그 펭귄의 재생이 지워졌거나(빈 곳 누르기, Ctrl+C, 장비 삭제, 가져오기, 다음 재생),
    // 추적이 바뀌어 이벤트를 찾을 수 없으면 카드를 내린다
    if (clockState.paused && cardStillShown(picked, replayList.map((replay) => replay.key), hasPickedEvent)) return;
    setPicked(null);
    cardPause.close();
  }, [clockState.paused, replayList, picked, hasPickedEvent, cardPause]);
  const pickPenguin = (pick: PenguinPick) => {
    if (mode !== "simulation") return;
    if (picked?.key === pick.key) { closeCard(); return; }
    // 보여 줄 이벤트가 없으면 카드도 없다. 시계만 멈추지 않게 그대로 둔다
    if (eventOf(pick) === undefined) return;
    cardPause.open();
    setPicked(pick);
    if (pick.traceId !== undefined) { setPickedTrace(pick.traceId); setSelectedSeq(pick.seq); }
  };
  // 이벤트 탭을 마지막으로 봤을 때의 최신 추적. 그 뒤에 새 기록이 생기면 탭에 점을 단다
  const [seenTrace, setSeenTrace] = useState<number | null>(null);
  const latestTrace = snapshot.traces[0]?.id ?? null;
  const shownTrace = pickedTrace ?? lastPlayed ?? latestTrace ?? undefined;
  const shownTraceData = shownTrace === undefined ? undefined : simulator.getTrace(shownTrace);
  const shownReplay = replayList.find((replay) => replay.traceId !== undefined && replay.traceId === shownTrace);
  // 고른 이벤트의 장비와 케이블을 캔버스에서 강조한다 (T1.9.3)
  const eventHighlight = mode === "simulation" && sideTab === "events" && selectedSeq !== null && shownTraceData !== undefined
    ? highlightOf(shownTraceData, selectedSeq) : undefined;
  useEffect(() => {
    if (sideTab === "events") setSeenTrace(latestTrace);
  }, [sideTab, latestTrace]);
  const sideHeader = mode === "simulation" ? (
    <SideTabs tab={sideTab} onTab={setSideTab} unread={latestTrace !== null && latestTrace !== seenTrace}
      count={shownTraceData?.events.length} />
  ) : undefined;
  const replayCount = useRef(0);
  const setReplayOf = (deviceId: string, replay: Replay | undefined) =>
    setReplays((current) => {
      if (replay === undefined && !current.has(deviceId)) return current;
      const next = new Map(current);
      if (replay === undefined) next.delete(deviceId);
      else next.set(deviceId, replay);
      return next;
    });
  // `key`: 재생의 주인. ping은 장비 ID, 경로 교환은 RIP_REPLAY_KEY
  const play = (key: string, traceId: number, exchange = false): number => {
    const trace = simulator.getTrace(traceId);
    if (trace === undefined) return 0;
    const { document: current } = simulator.getSnapshot();
    const lengthOf = (linkId: string) => cableLength(current, linkId);
    const timeline = exchange ? exchangeTimeline(trace, lengthOf) : previewTimeline(trace, lengthOf);
    replayCount.current += 1;
    const startedAt = clock.now();
    // 같은 주인의 앞 재생을 바꾸고, 다른 주인의 재생이 끝나 남아 있던 펭귄(놓침)도 지운다.
    // 다른 주인의 아직 걷는 중인 재생은 그대로 둔다
    setReplays((current) => {
      const next = new Map([...current].filter(([id, replay]) =>
        id !== key && startedAt - replay.startedAt < replay.timeline.durationMs));
      next.set(key, { key: `replay-${replayCount.current}`, timeline, startedAt, traceId });
      return next;
    });
    // 이벤트 목록은 새로 시작한 ping을 따라간다
    if (!exchange) { setLastPlayed(traceId); setPickedTrace(null); setSelectedSeq(null); }
    return timeline.durationMs;
  };
  const clearFinishedReplays = () =>
    setReplays((current) => {
      const time = clock.now();
      const next = new Map([...current].filter(([, replay]) => time - replay.startedAt < replay.timeline.durationMs));
      return next.size === current.size ? current : next;
    });

  const submit = (deviceId: string, input: string) => {
    void queue.enqueue(deviceId, async () => {
      const state = latest.current[deviceId];
      if (state === undefined) return;
      const controller = new AbortController();
      running.current.set(deviceId, controller);
      // 실행하는 사이에 장비가 지워졌으면 그 터미널의 기록을 되살리지 않는다 (T1.3.3)
      const update = (next: TerminalState) =>
        updateTerminals((current) => (current[deviceId] === undefined ? current : { ...current, [deviceId]: next }));
      // 회차를 하나씩 보일 때만 불린다. 바로 끝나는 명령어는 입력 줄이 깜빡이지 않는다
      const show = (next: TerminalState) => {
        setBusyFor(deviceId, true);
        update(next);
      };
      const device = simulator.getSnapshot().document.devices.find((candidate) => candidate.id === deviceId);
      try {
        const next = await runLinePaced(simulator.console(deviceId), state, input, {
          show,
          // 시뮬레이션이면 시뮬레이션 시계로 기다린다: 멈추면 줄도 서고, 2×면 간격도 절반 (T0.15)
          wait: (ms) => modeRef.current === "simulation" ? clock.wait(ms, controller.signal) :
            new Promise((resolve) => {
              if (controller.signal.aborted) return resolve(false);
              const timer = setTimeout(() => resolve(true), ms);
              controller.signal.addEventListener("abort", () => {
                clearTimeout(timer);
                resolve(false);
              });
            }),
          kindOf: (traceId, sequence) => {
            const trace = simulator.getTrace(traceId);
            return trace === undefined ? "reply" : pingRoundKind(trace, deviceId, sequence);
          },
          targetOf: (traceId) => {
            const summary = simulator.getSnapshot().traces.find((candidate) => candidate.id === traceId);
            return summary?.kind === "ping" ? summary.targetIp : "";
          },
          isHop: (traceId) => {
            const summary = simulator.getSnapshot().traces.find((candidate) => candidate.id === traceId);
            // 서비스 요청(T0.20)도 회차가 하나라, 멈추면 ping 통계 없이 `^C`만 찍는다
            return summary?.kind === "ping" && (summary.hop !== undefined || summary.service !== undefined);
          },
          os: device !== undefined && (device.kind === "pc" || device.kind === "server") ? osOf(device.config) : "windows",
          // 실시간이면 재생하지 않는다. 0을 돌려주면 회차 줄이 실제 OS처럼 바로 뜬다 (응답 없는 회차는 4초)
          play: (traceId) => (modeRef.current === "simulation" ? play(deviceId, traceId) : 0),
        });
        update(next);
      } finally {
        running.current.delete(deviceId);
        setBusyFor(deviceId, false);
      }
    });
  };

  const removeDevice = (deviceId: string) => {
    // 그 장비에서 회차를 보이던 ping을 멈춘다
    running.current.get(deviceId)?.abort();
    const result = simulator.dispatch({ type: "device/remove", deviceId });
    setRemoveAsk(null);
    setActionError(result.ok ? null : result.error);
    // 지운 장비나 그 케이블 위를 걷던 펭귄이 남지 않게 한다
    if (result.ok) { setBoxSel(EMPTY_SEL); setReplays(new Map()); }
  };

  /** 범위 선택 삭제 버튼이나 Delete 키. 케이블이 딸린 장비나 고른 케이블이 있으면 한 번 묻는다 (T0.42) */
  const requestRemoveSelection = () => {
    const hasLink = boxSel.links.length > 0 ||
      document.links.some(link => link.ends.some(end => boxSel.devices.includes(end.deviceId)));
    if (!hasLink) return removeSelection();
    setMultiAsk(true);
  };

  const removeSelection = () => {
    setMultiAsk(false);
    let error: ErrorInfo | null = null;
    for (const deviceId of boxSel.devices) {
      running.current.get(deviceId)?.abort();
      const result = simulator.dispatch({ type: "device/remove", deviceId });
      if (!result.ok) error = result.error;
    }
    for (const linkId of boxSel.links) {
      const result = simulator.dispatch({ type: "link/remove", linkId });
      if (!result.ok) error = result.error;
    }
    setActionError(error);
    setBoxSel(EMPTY_SEL);
    setSelectedLinkId(null);
    dispatch({ type: "select", deviceId: null });
    setReplays(new Map());
  };

  /** 삭제 버튼이나 Delete 키. 케이블이 연결된 장비는 속성 패널에서 한 번 더 묻는다 (T1.4.3, FR-11) */
  const requestRemove = (deviceId: string) => {
    if (!document.links.some((link) => link.ends.some((end) => end.deviceId === deviceId))) return removeDevice(deviceId);
    setSelectedLinkId(null);
    dispatch({ type: "select", deviceId });
    setRemoveAsk(deviceId);
  };

  // 다른 것을 고르면 묻던 것을 그만둔다
  useEffect(() => {
    setRemoveAsk((current) => (current === ui.selectedDeviceId && selectedLinkId === null ? current : null));
  }, [ui.selectedDeviceId, selectedLinkId]);

  // Delete·Backspace: 고른 장비나 케이블을 지운다. 포커스가 고르지 않은 것에 있으면 그것을 먼저 고른다 (T1.3.3).
  // 입력란과 터미널 안에서는 글자를 지우는 키라서 건드리지 않는다
  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (!isRemoveKey(event) || cable.active || dragKind !== null || importAsk !== null) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], .term") != null) return;
      if (boxSelCount > 0) {
        // 묶음을 고른 뒤에는 묶음을 지운다. 고르지 않은 장비·케이블에 포커스가 있으면 그것을 먼저 고른다 (T1.3.3 규칙)
        const focused = target?.closest("g.node")?.getAttribute("data-device-id") ?? null;
        const focusedLink = target?.closest("g.link")?.getAttribute("data-link-id") ?? null;
        if (focused !== null && !boxSel.devices.includes(focused)) return selectDevice(focused);
        if (focusedLink !== null && !boxSel.links.includes(focusedLink)) return selectLink(focusedLink);
        event.preventDefault();
        return requestRemoveSelection();
      }
      const action = removeKeyAction({
        focusedDeviceId: target?.closest("g.node")?.getAttribute("data-device-id") ?? null,
        focusedLinkId: target?.closest("g.link")?.getAttribute("data-link-id") ?? null,
        selectedDeviceId: ui.selectedDeviceId,
        selectedLinkId: selectedLink?.id ?? null,
      });
      if (action === null) return;
      event.preventDefault();
      if (action.type === "select-device") selectDevice(action.deviceId);
      else if (action.type === "remove-device") requestRemove(action.deviceId);
      else if (action.type === "select-link") selectLink(action.linkId);
      else removeSelectedLink();
    };
    window.addEventListener("keydown", onDelete);
    return () => window.removeEventListener("keydown", onDelete);
  });

  /** Ctrl+C. 회차를 보이는 중이면 멈추고 true */
  const interrupt = (deviceId: string): boolean => {
    const controller = running.current.get(deviceId);
    if (controller === undefined || controller.signal.aborted) return false;
    controller.abort();
    // 걷던 펭귄도 사라진다
    setReplayOf(deviceId, undefined);
    return true;
  };

  const stepHistory = (deviceId: string, direction: "up" | "down"): string => {
    const state = latest.current[deviceId];
    if (state === undefined) return "";
    const step = historyStep(state, direction);
    updateTerminals((current) => ({ ...current, [deviceId]: step.state }));
    return step.input;
  };

  // Tab: 지금 모드에서 완성한 줄을 바로 돌려준다. 화면 기록은 바뀌지 않는다
  const complete = (deviceId: string, input: string): string => completed(simulator.console(deviceId), input);

  // Tab 두 번: `?`와 같은 대기열에서 후보 목록을 더한다 (T0.19)
  const candidates = (deviceId: string, input: string) => {
    void queue.enqueue(deviceId, async () => {
      const state = latest.current[deviceId];
      if (state === undefined) return;
      const next = showCandidates(simulator.console(deviceId), state, input);
      updateTerminals((current) => ({ ...current, [deviceId]: next }));
    });
  };

  // `?`: 실행과 같은 대기열에 넣는다. 앞 명령의 결과보다 먼저 끼어들거나 그 결과에 덮이지 않는다
  const help = (deviceId: string, input: string) => {
    void queue.enqueue(deviceId, async () => {
      const state = latest.current[deviceId];
      if (state === undefined) return;
      const next = showHelp(simulator.console(deviceId), state, input);
      updateTerminals((current) => ({ ...current, [deviceId]: next }));
    });
  };

  // 지금 Document를 파일로 받는다 (T7.1.1). 장비가 없어도 받는다
  const exportTopology = () => {
    const file = exportFile(topologyName, simulator.getSnapshot().document);
    // 저장 창이 거절되거나 쓰기가 실패하면 배너로 보인다 (T17.5)
    void (download ?? browserDownload)(file.fileName, file.text).catch((reason: unknown) => {
      setActionError(errorInfo("EXPORT_FAILED", { message: reason instanceof Error ? reason.message : String(reason) }));
    });
  };

  // 고른 파일을 검증하고, 캔버스에 장비가 있으면 바꿀지 묻는다 (T7.1.2). 실패하면 지금 캔버스는 그대로
  const importTopology = async (file: File) => {
    setImportError(null);
    const result = await readImportFile(file);
    if (!result.ok) return setImportError(result.error);
    const pending: PendingImport = { fileName: file.name, name: importNameOf(file.name, result.name), document: result.document };
    if (needsReplaceConfirm(simulator.getSnapshot().document)) setImportAsk(pending);
    else replaceTopology(pending);
  };

  // 지금 토폴로지를 바꾼다. 열면 Runtime이 비어 있듯이 화면 상태도 처음으로: 선택, 터미널과 그 기록, 펭귄, 도구.
  // 모드는 그대로 둔다
  const replaceTopology = ({ fileName, name, document: next }: PendingImport) => {
    setImportAsk(null);
    for (const controller of running.current.values()) controller.abort();
    const result = simulator.load(next);
    if (!result.ok) return setImportError(result.error);
    setTopologyName(name);
    setSourceFile(fileName);
    updateTerminals(() => ({}));
    setBusy(new Set());
    dispatch({ type: "sync", deviceIds: [] });
    setReplays(new Map());
    setCable(CABLE_OFF); setDragKind(null); setSelectedLinkId(null); setRemoveAsk(null);
    setActionError(null); setConnectionMessage(null);
    setPickedTrace(null); setLastPlayed(null); setSelectedSeq(null); setSeenTrace(null);
    setBoxSel(EMPTY_SEL); setMultiAsk(false);
  };

  // 파일 메뉴의 새 토폴로지 (T0.49). 장비가 있으면 바꿀지 묻는 절차는 가져오기와 같다
  const newTopology = () => {
    const pending: PendingImport = { fileName: null, name: TOPOLOGY_NAME, document: EMPTY_DOCUMENT };
    if (needsReplaceConfirm(simulator.getSnapshot().document)) setImportAsk(pending);
    else replaceTopology(pending);
  };

  // 데스크톱 앱의 파일 메뉴(가져오기/내보내기)가 같은 절차를 부르게 액션을 넘긴다 (T0.40).
  // Tauri 연결 자체는 앱 쪽 파일(file-platform.ts)이 한다 — editor는 Tauri를 모른다 (E3.0)
  const menuActions = useRef({ doExport: exportTopology, doImport: importTopology, doNew: newTopology });
  useEffect(() => { menuActions.current = { doExport: exportTopology, doImport: importTopology, doNew: newTopology }; });
  useEffect(() => {
    onActions?.({
      exportTopology: () => menuActions.current.doExport(),
      importTopology: async (file: File) => menuActions.current.doImport(file),
      newTopology: () => menuActions.current.doNew(),
      openAbout: () => setAboutOpen(true),
      undo: () => simulator.undo(),
      redo: () => simulator.redo(),
    });
  }, [onActions]);

  return (
    <div className={`app mode-${mode}`}>
      <TopBar name={topologyName} fileName={sourceFile} onRename={setTopologyName}
        onExport={features?.fileActions === false ? undefined : exportTopology}
        onImport={features?.fileActions === false ? undefined : (file) => void importTopology(file)}
        mode={mode} onModeChange={changeMode}
        onHelp={() => setHelpOpen(true)} onAbout={() => setAboutOpen(true)}
        sim={mode === "simulation" ? { clock: clockState, onPause: clock.pause, onResume: clock.resume, onSpeed: clock.setSpeed } : undefined}
        onReset={() => simulator.resetSimulation()} />
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onAbout={() => { setHelpOpen(false); setAboutOpen(true); }} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {cloudInside !== null && snapshot.views[cloudInside]?.kind === "cloud" &&
        <CloudInsideDialog document={document} deviceId={cloudInside}
          view={snapshot.views[cloudInside] as Extract<typeof snapshot.views[string], { kind: "cloud" }>}
          onClose={() => setCloudInside(null)} />}
      <main className={`work${side.dragging ? " side-dragging" : ""}`} style={{ gridTemplateColumns: `76px minmax(0, 1fr) ${side.width}px` }}>
        {side.handle}
        <Palette deviceCount={document.devices.length} linkCount={document.links.length} cableActive={cable.active}
          onConnect={() => { setCable(cable.active ? CABLE_OFF : CABLE_READY); setSelectActive(false); setConnectionMessage(null); setActionError(null); }}
          onDeviceDragStart={(kind, cliStyle) => { setDragKind(kind); setDragCliStyle(cliStyle ?? "ios"); setCable(CABLE_OFF); setSelectActive(false); setConnectionMessage(null); }}
          dragCancel={dragCancel} zoneRef={paletteRef} />
        <section className="canvas" onPointerDownCapture={releaseFocus}>
          {actionError !== null && <div className="canvas-error" role="alert">{formatError(actionError)}</div>}
          {importError !== null && <div className="import-error" role="alert">
            <span>⚠️ 가져오지 못했어요: {formatError(importError)}</span>
            <button type="button" aria-label="알림 닫기" onClick={() => setImportError(null)}>×</button>
          </div>}
          {(dragKind !== null || cable.active) && <div className="edit-banner" role="status">
            <span>{dragKind !== null ? `${KIND_LABEL[dragKind]}${dragKind === "router" && dragCliStyle !== "ios" ? ` (${dragCliStyle.toUpperCase()})` : ""}를 원하는 위치에 놓으세요 · 왼쪽 목록에 다시 놓으면 취소` :
              connectionMessage ?? (cable.first === null ? "케이블 선택됨 · 첫 번째 장비를 클릭해 포트를 고르세요" :
                `${document.devices.find(device => device.id === cable.first?.deviceId)?.name ?? "장비"} ${shortPortName(cable.first.port)} 선택됨 · 두 번째 장비를 클릭하세요`)}</span>
            {cable.active && <button type="button" onClick={() => setCable(CABLE_OFF)}>연결 도구 해제</button>}
          </div>}
          <Canvas
            document={document}
            selectedDeviceId={ui.selectedDeviceId}
            onSelect={selectDevice}
            onOpenTerminal={openTerminal}
            selectedLinkId={selectedLinkId}
            onSelectLink={selectLink}
            onDropDevice={addDevice} onMoveDevice={moveDevice}
            paletteDragKind={dragKind} paletteDragCliStyle={dragCliStyle} onPaletteDragEnd={() => setDragKind(null)}
            onDeviceDrag={() => setCable(current => ({ ...current, pickerDeviceId: null }))}
            cableActive={cable.active} selectActive={selectActive}
            firstPort={cable.first} pickerDeviceId={cable.pickerDeviceId}
            onPickPort={pickPort} onClosePortPicker={() => setCable(current => ({ ...current, pickerDeviceId: null }))}
            replays={replayList} onCanvasClick={() => {
              // 빈 곳을 누르면 선택한 장비·케이블을 푼다 (T0.17)
              clearFinishedReplays();
              setBoxSel(EMPTY_SEL);
              setSelectedLinkId(null);
              dispatch({ type: "select", deviceId: null });
            }}
            selectedDeviceIds={new Set(boxSel.devices)} selectedLinkIds={new Set(boxSel.links)}
            onBoxSelect={applyBoxSelection}
            onToggleDevice={(deviceId) => toggleSelection(deviceId, null)}
            onToggleLink={(linkId) => toggleSelection(null, linkId)}
            cancelZoneRef={paletteRef} onCancelZone={setDragCancel}
            replayTime={clock.now} replayPaused={clockState.paused}
            eventHighlight={eventHighlight}
            {...(mode === "simulation" ? { onPickPenguin: pickPenguin } : {})}
            pickedPenguin={picked}
            penguinCard={picked !== null && pickedEvent !== undefined
              ? <PacketCard event={pickedEvent} document={document} linkId={picked.linkId}
                  onClose={closeCard} />
              : undefined}
          />
          {ui.terminals.map((placement, index) => {
            const device = document.devices.find((candidate) => candidate.id === placement.deviceId);
            const state = terminals[placement.deviceId];
            if (device === undefined || state === undefined) return null;
            return (
              <TerminalWindow
                key={placement.deviceId}
                deviceName={device.name}
                kindLabel={KIND_LABEL[device.kind]}
                state={state}
                busy={busy.has(placement.deviceId)}
                placement={placement}
                zIndex={TERMINAL_Z + index}
                onSubmit={(input) => submit(placement.deviceId, input)}
                onHistory={(direction) => stepHistory(placement.deviceId, direction)}
                onComplete={(input) => complete(placement.deviceId, input)}
                onCandidates={(input) => candidates(placement.deviceId, input)}
                onHelp={(input) => help(placement.deviceId, input)}
                onLeave={() => focusCanvasNode(placement.deviceId)}
                onInterrupt={() => interrupt(placement.deviceId)}
                onClose={() => dispatch({ type: "close-terminal", deviceId: placement.deviceId })}
                onFocus={() => dispatch({ type: "focus-terminal", deviceId: placement.deviceId })}
                onMove={(x, y) => dispatch({ type: "move-terminal", deviceId: placement.deviceId, x, y })}
              />
            );
          })}
        </section>
        {mode === "simulation" && sideTab === "events" ? (
          <EventPanel header={sideHeader} document={document} traces={snapshot.traces} getTrace={simulator.getTrace}
            traceId={shownTrace} onPickTrace={(traceId) => { setPickedTrace(traceId); setSelectedSeq(null); }}
            replay={shownReplay} time={clock.now} paused={clockState.paused}
            selectedSeq={selectedSeq} onSelectSeq={setSelectedSeq} />
        ) : boxSelCount >= 2 ? (
          <aside className="inspector">
            {sideHeader}
            <div className="inspector-idle">
              <div className="idle-text">
                <b>{boxSel.devices.length}대의 장비</b>와 <b>{boxSel.links.length}개의 케이블</b>을 골랐어요.
                <br />연결된 케이블은 장비와 함께 지워집니다.
              </div>
              <div className="multi-actions">
                <button type="button" onClick={requestRemoveSelection}>모두 지우기</button>
                <button type="button" onClick={() => setBoxSel(EMPTY_SEL)}>선택 해제</button>
              </div>
            </div>
          </aside>
        ) : selectedLink !== undefined ? <LinkInspector document={document} link={selectedLink} onRemove={removeSelectedLink} header={sideHeader} /> : <Inspector
          header={sideHeader}
          snapshot={snapshot}
          deviceId={ui.selectedDeviceId}
          onOpenTerminal={openTerminal}
          onDispatch={simulator.dispatch}
          onRemove={requestRemove}
          removeAsk={removeAsk !== null && removeAsk === ui.selectedDeviceId}
          onConfirmRemove={() => { if (removeAsk !== null) removeDevice(removeAsk); }}
          onCancelRemove={() => setRemoveAsk(null)}
          routeChangesOf={simulator.getRouteChanges}
          onPlayExchange={mode === "simulation" ? (traceId) => play(RIP_REPLAY_KEY, traceId, true) : undefined}
        />}
      </main>
      {multiAsk && (
        <ConfirmDialog title="고른 항목을 지울까요?" confirmLabel="지우기"
          onConfirm={removeSelection} onCancel={() => setMultiAsk(false)}>
          <p>장비 {boxSel.devices.length}대와 케이블 {boxSel.links.length}개를 지웁니다. 장비에 연결된 케이블도 함께 지워져요.</p>
        </ConfirmDialog>
      )}
      {importAsk !== null && (
        <ConfirmDialog title="지금 토폴로지를 바꿀까요?" confirmLabel="바꾸기"
          onConfirm={() => replaceTopology(importAsk)} onCancel={() => setImportAsk(null)}>
          <p>{importAsk.fileName === null ? "새 토폴로지를 만들면" : `"${importAsk.fileName}" 파일을 열면`} 지금 캔버스의 장비와 케이블이 사라져요.</p>
          <p>먼저 <b>⤓ 내보내기</b>로 받아 둘 수 있어요.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
