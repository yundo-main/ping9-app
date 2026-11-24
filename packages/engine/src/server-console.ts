// Server 장비의 콘솔 경계 (T0.25). console.ts의 PC 경로를 복사한 독립 구현이다.
// 서버는 언제나 Linux다: `sudo`는 빈칸으로 바꿔 읽고(T14.2.1), `iptables`는 명령 정의가 아니라 따로 읽는다(T0.21).

import { LIMITS, errorInfo, isServerDevice, osOf } from "@ping9/shared";
import type { ConsoleLine, ConsoleResult, Device, HelpEntry, ServerDevice } from "@ping9/shared";

import { iosCandidates, iosComplete, iosExec, iosHelp } from "./cli/ios";
import type { PathCompleter } from "./cli/ios";
import type { IosConsoleEnv } from "./cli/ios";
import { splitWords } from "./cli/ios/parse";
import {
  initialFiles,
  parseEcho,
  pathCompletions,
  runEcho,
  serverCommandsFor,
  serverPrompt,
  unknownCommandText,
  unsupportedSyntaxAt,
} from "./cli/server";
import type { ServerFiles } from "./cli/server";
import { runIptables } from "./cli/server";
import type { ConsolePort } from "./console";

/**
 * 첫 단어가 없는 명령어면 셸의 줄(`ls: command not found`)과 한국어 안내로 바꾼다 (T0.9).
 * 첫 단어는 맞고 뒤가 틀린 줄은 `^` 표시가 있는 오류 그대로 둔다
 */
function serverUnknownCommand(lines: readonly ConsoleLine[], text: string): readonly ConsoleLine[] {
  const [only] = lines;
  const first = splitWords(text)[0];
  if (lines.length !== 1 || only?.kind !== "error" || only.code !== "CLI_UNKNOWN_COMMAND") return lines;
  if (first === undefined || only.position !== first.position) return lines;
  return [
    ...unknownCommandText(only.params.token).map((line): ConsoleLine => ({ kind: "text", text: line })),
    { kind: "notice", code: "PC_UNKNOWN_COMMAND", params: { token: only.params.token } },
  ];
}

export function createServerConsolePort(deviceId: string, env: IosConsoleEnv): ConsolePort {
  const findServer = (): ServerDevice | undefined => {
    const device = env.getDocument().devices.find((candidate) => candidate.id === deviceId);
    return isServerDevice(device) ? device : undefined;
  };
  // 파일 트리가 없는 환경(일부 테스트)에서는 늘 처음 상태다
  const filesOf = (server: ServerDevice): ServerFiles => env.getFiles?.(server.id, "linux") ?? initialFiles("linux");
  // 경로 자리에서 Tab이 파일·폴더 이름을 채운다 (T0.19)
  const pathsOf = (device: Device): PathCompleter | undefined =>
    isServerDevice(device) ? (typed, dirsOnly) => pathCompletions(filesOf(device), typed, dirsOnly) : undefined;

  const prompt = (): string => {
    const server = findServer();
    return server === undefined ? ">" : serverPrompt(server, filesOf(server));
  };

  const result = (...lines: ConsoleLine[]): ConsoleResult => ({ lines, prompt: prompt() });

  // `sudo`를 같은 길이의 빈칸으로 바꿔 읽는다. 오류의 `^` 위치가 그대로다 (T14.2.1, T0.21)
  const SUDO = /^(\s*)sudo(?=\s)/;
  const withoutSudo = (line: string): string => line.replace(SUDO, "$1    ");

  // 완성과 도움말을 계산할 수 있는 경우만 돌려준다. 장비가 없거나,
  // 글이 아니거나 너무 긴 줄이면 완성도 도움말도 없다 (예외를 던지지 않는다, AD-16)
  const assistTarget = (line: unknown) => {
    const server = findServer();
    if (server === undefined) return undefined;
    if (typeof line !== "string" || line.length > LIMITS.maxConsoleLineLength) return undefined;
    return { text: withoutSudo(line), device: server, definitions: serverCommandsFor() };
  };

  return {
    prompt,

    exec: async (line: string): Promise<ConsoleResult> => {
      const server = findServer();
      if (server === undefined) {
        return result({ kind: "error", code: "DEVICE_NOT_FOUND", params: { deviceId } });
      }

      const text = withoutSudo(typeof line === "string" ? line : "");
      if (text.length > LIMITS.maxConsoleLineLength) {
        return result({
          kind: "error",
          code: "CLI_LINE_TOO_LONG",
          params: { limit: LIMITS.maxConsoleLineLength },
        });
      }

      // `echo <글>`, `echo <글> > <파일>`은 리다이렉트 기호 검사의 예외다 (T0.19 설계안 결정 3)
      const echo = parseEcho(text, osOf(server.config));
      if (echo !== undefined) {
        const outcome = runEcho(filesOf(server), echo);
        if (outcome.files !== undefined) env.setFiles?.(server.id, outcome.files);
        return result(...(outcome.lines ?? []).map((line): ConsoleLine => ({ kind: "text", text: line })));
      }

      // 한 줄에 명령 하나다. 파이프, 리다이렉트, 명령 연결은 실행하지 않는다 (T0.9)
      const blocked = unsupportedSyntaxAt(text);
      if (blocked !== undefined) {
        return result({
          kind: "error",
          ...errorInfo("CLI_UNSUPPORTED_SYNTAX", { token: blocked.token }),
          position: blocked.position,
        });
      }

      // `iptables`는 옵션 순서가 자유로워 명령 정의로 읽지 않고 따로 읽는다 (T14.2.1, T0.21)
      const [first, ...rest] = splitWords(text);
      if (first?.text === "iptables") return result(...runIptables(rest, server, env.dispatch));

      const executed = iosExec(text, server, serverCommandsFor(), env);
      // iosExec의 프롬프트는 IOS 모드의 것이다. 서버는 실행 뒤의 문서로 프롬프트를 다시 만든다
      return { lines: serverUnknownCommand(executed.lines, text), prompt: prompt() };
    },

    complete: (line: string): string | null => {
      const target = assistTarget(line);
      if (target === undefined) return null;
      const completed = iosComplete(target.text, target.device, target.definitions, env, pathsOf(target.device));
      // 빈칸으로 바꿔 읽은 `sudo`를 완성한 줄에 되돌린다
      const sudo = target.text === line ? null : SUDO.exec(line);
      return completed === null || sudo === null || !completed.startsWith(" ".repeat(sudo[0].length))
        ? completed : `${sudo[0]}${completed.slice(sudo[0].length)}`;
    },

    candidates: (line: string): readonly string[] => {
      const target = assistTarget(line);
      // Tab을 두 번 누르면 그 자리에서 칠 수 있는 것을 나열한다 (T0.19)
      return target === undefined ? [] : iosCandidates(target.text, target.device, target.definitions, env, pathsOf(target.device));
    },

    help: (line: string): HelpEntry[] => {
      const target = assistTarget(line);
      return target === undefined ? [] : iosHelp(target.text, target.device, target.definitions, env);
    },
  };
}
