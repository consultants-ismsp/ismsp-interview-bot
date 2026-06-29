// 자동 인터뷰용 질문 목록 Route Handler.
// 담당자(+선택 영역)의 평가항목 질문을 세부번호 순으로 반환한다.
// 주의: 현황 사실(asis)은 내려보내지 않는다 — 질문(확인사항)만 노출한다.
import { NextRequest } from "next/server";
import { getPersona } from "@/lib/personas";
import { getChecklist, toInterviewQuestion } from "@/lib/knowledge";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const personaId = searchParams.get("personaId") ?? undefined;

  const persona = getPersona(personaId);
  if (!persona) {
    return jsonError(400, "담당자(personaId)를 찾을 수 없습니다");
  }

  // checklist.json에서 담당자 질문을 세부번호 순으로. 질문은 구어체로 변환해 내려보낸다.
  const items = getChecklist(persona.id).map((it) => ({
    sebu: it.sebu,
    control: it.control,
    question: toInterviewQuestion(it.question),
  }));

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
