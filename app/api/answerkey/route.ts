// 정합성 대조 Route Handler. 종합 초안과 나란히 볼 '원본 진단결과/As-Is'를 내려준다.
// 주의: 이 데이터는 화면 대조 표시 전용이다. 절대 페르소나/LLM 입력으로 쓰지 않는다.
import { NextRequest } from "next/server";
import { getPersona } from "@/lib/personas";
import { getCompareRows } from "@/lib/knowledge";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const persona = getPersona(searchParams.get("personaId") ?? undefined);
  if (!persona) {
    return new Response(JSON.stringify({ error: "담당자(personaId)를 찾을 수 없습니다" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const area = searchParams.get("area")?.trim() || undefined;
  const rows = getCompareRows(persona.id, area);

  return new Response(JSON.stringify({ rows }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
