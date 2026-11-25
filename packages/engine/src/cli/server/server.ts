// Server 장비의 콘솔이 쓰는 것 (T0.25). cli/pc의 Linux 구현을 복사한 독립 구현이다.
// 서버는 언제나 Linux라 OS를 고르는 분기가 없다. Windows 명령어 목록은 없다.

import type { ServerDevice } from "@ping9/shared";

import { defineCommand } from "../ios";
import type { CommandDefinition } from "../ios";
import { LINUX_FILE_COMMANDS } from "./file-commands";
import { folderLabel } from "./file-tree";
import type { ServerFiles } from "./file-tree";
import { LINUX_SERVER_COMMANDS } from "./linux-commands";
import { LINUX_NETWORK_COMMANDS } from "./ping";
import { LINUX_SERVICE_COMMANDS, SERVER_ONLY_COMMANDS } from "./service-commands";
import { SSH_COMMANDS } from "../ssh";
import { LINUX_TRACE_COMMANDS } from "./traceroute";

/** 명령 정의의 쓰는 형태. 매개변수 자리는 `<ip>`처럼 보인다 */
function usageOf(definition: CommandDefinition): string {
  return definition.tokens.map((token) => (typeof token === "string" ? token : `<${token.param}>`)).join(" ");
}

/**
 * `help` (T0.9): 칠 수 있는 명령어를 모두 쓰는 형태와 설명으로 보인다.
 * `?`는 그 자리에 올 단어만 보이고, `help`는 전체 목록이다
 */
function helpCommand(commands: () => readonly CommandDefinition[]): CommandDefinition {
  return defineCommand({
    modes: ["user"],
    devices: ["server"],
    tokens: ["help"],
    help: "Show all commands",
    run: () => {
      const rows = commands()
        .map((definition) => ({ usage: usageOf(definition), help: definition.help }))
        .sort((left, right) => (left.usage < right.usage ? -1 : left.usage > right.usage ? 1 : 0));
      const width = Math.max(...rows.map((row) => row.usage.length));
      return { lines: rows.map((row) => ({ kind: "text" as const, text: `  ${row.usage.padEnd(width)}  ${row.help}` })) };
    },
  });
}

// ping과 ARP 명령어(T1.8.3), traceroute(T11.4.1)는 Runtime을 쓰므로 따로 정의하고 여기서 붙인다.
// Linux는 실제처럼 대소문자를 구분한다 (T0.9)
const SERVER_COMMANDS: readonly CommandDefinition[] = [
  ...LINUX_SERVER_COMMANDS,
  ...LINUX_FILE_COMMANDS,
  ...LINUX_NETWORK_COMMANDS,
  ...LINUX_TRACE_COMMANDS,
  ...LINUX_SERVICE_COMMANDS,
  ...SSH_COMMANDS,
  ...SERVER_ONLY_COMMANDS,
  helpCommand(() => SERVER_COMMANDS),
].map((definition) => ({ ...definition, caseSensitive: true }));

/** 이 서버의 콘솔이 쓰는 명령 정의 목록 */
export function serverCommandsFor(): readonly CommandDefinition[] {
  return SERVER_COMMANDS;
}

/** 프롬프트: 장비 이름과 지금 폴더 이름만. `user@Server1 ~ $`, `user@Server1 / $` */
export function serverPrompt(server: ServerDevice, files: ServerFiles): string {
  return `user@${server.name} ${folderLabel(files)} $`;
}

/** 첫 단어가 없는 명령어일 때 셸이 내는 줄. 한국어 안내는 따로 붙는다 */
export function unknownCommandText(token: string): readonly string[] {
  return [`${token}: command not found`];
}

export { unsupportedSyntaxAt } from "./syntax";
