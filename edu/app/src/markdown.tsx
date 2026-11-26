// 레슨 브리프용 최소 마크다운 렌더 — 제목·코드 블록·인라인 코드·굵게·목록·단락.
// 브리프는 저작자(개발)가 쓰는 내용이라 외부 입력이 아니며, 하위 집합만 지원한다.
// 의존을 늘리지 않으려고 직접 구현 — 지원 범위를 넘는 마크업은 텍스트로 그대로 보인다.

import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  // `code`와 **bold**를 하나의 정규식으로 쪼갠다
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.filter((part) => part !== "").map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function Markdown({ text }: { readonly text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") { index += 1; continue; }

    // ``` fenced 코드 블록
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith("```")) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push(<pre key={blocks.length}><code>{codeLines.join("\n")}</code></pre>);
      continue;
    }

    // 제목
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading !== null) {
      const level = heading[1]!.length;
      const Tag = (`h${level + 1}`) as "h2" | "h3" | "h4";
      blocks.push(<Tag key={blocks.length}>{inline(heading[2]!)}</Tag>);
      index += 1;
      continue;
    }

    // 목록 — 연속된 - 줄을 묶는다
    if (line.trimStart().startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index]!.trimStart().startsWith("- ")) {
        items.push(lines[index]!.trimStart().slice(2));
        index += 1;
      }
      blocks.push(<ul key={blocks.length}>{items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
      continue;
    }

    // 단락 — 빈 줄이나 다른 블록 시작 전까지 이어진다
    const para: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== ""
      && !lines[index]!.trimStart().startsWith("```")
      && !lines[index]!.trimStart().startsWith("- ")
      && !lines[index]!.match(/^#{1,3}\s/)) {
      para.push(lines[index]!);
      index += 1;
    }
    blocks.push(<p key={blocks.length}>{inline(para.join("\n"))}</p>);
  }
  return <div className="edu-md">{blocks}</div>;
}
