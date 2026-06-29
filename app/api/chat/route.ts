// 채팅 Route Handler. 브라우저 → 여기(서버) → OpenRouter. API 키는 서버에만 존재한다.
import { NextRequest } from "next/server";
import { getPersona } from "@/lib/personas";
import { buildKnowledgeBlock } from "@/lib/knowledge";
import { streamChat, MissingKeyError, type ChatMessage } from "@/lib/openrouter";

// env(OPENROUTER_API_KEY)를 읽어야 하므로 edge 말고 node 런타임.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[]; personaId?: string; area?: string; sebuList?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "요청 본문(JSON)을 읽지 못했습니다");
  }

  // personaId로 담당자 시스템 프롬프트를 찾는다.
  const persona = getPersona(body.personaId);
  if (!persona) {
    return jsonError(400, "담당자(personaId)를 찾을 수 없습니다");
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  // user/assistant 히스토리만 신뢰. 시스템 프롬프트는 서버에서 맨 앞에 붙인다.
  const clean = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  // 담당자 지식(보유 자산 + 운영 현황)을 systemPrompt 뒤에 붙인다. 세부번호는 넣지 않는다.
  //  - sebuList(자동 인터뷰): 그 항목 통제항목 현황만  · area(종합): 그 영역만  · 둘 다 없으면 전체.
  const block = buildKnowledgeBlock(persona.id, {
    sebuList: body.sebuList,
    area: body.area?.trim() || undefined,
  });
  const systemContent = block ? `${persona.systemPrompt}\n${block}\n` : persona.systemPrompt;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...clean,
  ];

  try {
    const upstream = await streamChat(messages);
    // OpenRouter의 SSE 스트림을 그대로 클라이언트로 흘려보낸다.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    if (e instanceof MissingKeyError) {
      return jsonError(500, e.message);
    }
    return jsonError(502, (e as Error).message ?? "LLM 호출 중 오류가 발생했습니다");
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
