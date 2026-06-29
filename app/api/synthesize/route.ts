// As-Is 종합 Route Handler. 담당자 인터뷰 대화(transcript)를 받아 As-Is 초안을 작성한다.
// 비스트리밍: 완성된 초안 텍스트를 JSON으로 반환(별도 패널 표시/복사용).
import { NextRequest } from "next/server";
import { getPersona } from "@/lib/personas";
import { buildQuestionList } from "@/lib/knowledge";
import { SYNTH_SYSTEM } from "@/lib/synthesizer";
import { completeChat, MissingKeyError, type ChatMessage } from "@/lib/openrouter";

export const runtime = "nodejs";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  let body: { personaId?: string; area?: string; transcript?: Turn[] };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "요청 본문(JSON)을 읽지 못했습니다");
  }

  const persona = getPersona(body.personaId);
  if (!persona) {
    return jsonError(400, "담당자(personaId)를 찾을 수 없습니다");
  }

  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const clean = transcript.filter(
    (t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
  );
  if (clean.length === 0) {
    return jsonError(400, "종합할 인터뷰 대화가 없습니다");
  }

  // checklist의 평가항목(질문) 목록 — 작성자가 어떤 항목을 채울지 가이드로 쓴다.
  const area = body.area?.trim() || undefined;
  const questionList = buildQuestionList(persona.id, area);

  // 대화 로그를 텍스트로 직렬화.
  const log = clean
    .map((t) => `${t.role === "user" ? "[질문]" : "[담당자]"} ${t.content}`)
    .join("\n");

  const userBlock =
    `담당자: ${persona.name}${area ? ` · 통제영역 ${area}` : ""}\n\n` +
    (questionList ? `[평가항목(채울 대상)]\n${questionList}\n\n` : "") +
    `[인터뷰 대화 로그]\n${log}\n\n` +
    `위 대화에서 언급된 사실만으로 항목별 As-Is 현황 초안을 작성하라.`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYNTH_SYSTEM },
    { role: "user", content: userBlock },
  ];

  try {
    const draft = await completeChat(messages);
    return new Response(JSON.stringify({ draft }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof MissingKeyError) {
      return jsonError(500, e.message);
    }
    return jsonError(502, (e as Error).message ?? "종합 중 오류가 발생했습니다");
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
