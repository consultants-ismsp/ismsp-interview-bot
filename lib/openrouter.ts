// OpenRouter(OpenAI 호환) 서버용 스트리밍 래퍼.
// rookies/lib/llm/openaiCompatible.ts 패턴을 서버용으로 단순화하고 stream:true만 추가했다.
// 키/모델/base_url은 전부 env에서 읽는다. 이 파일은 서버에서만 import된다(키가 클라로 안 샌다).

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class MissingKeyError extends Error {}

// env에서 설정을 읽는다. 키가 없으면 MissingKeyError를 던져 호출부에서 친절히 안내.
function readConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new MissingKeyError(".env에 OPENROUTER_API_KEY를 넣으세요");
  }
  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(
    /\/+$/,
    "",
  );
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6";
  return { apiKey, baseUrl, model };
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    // OpenRouter가 권장하는 식별 헤더(없어도 동작하지만 넣어두면 깔끔).
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "ISMS-P Interview Chatbot",
  };
}

// OpenRouter chat/completions를 stream:true로 호출하고 raw SSE 응답(Response)을 그대로 돌려준다.
// SSE 파싱은 하지 않는다 — 호출부(route.ts)가 body를 그대로 클라이언트로 릴레이한다.
export async function streamChat(messages: ChatMessage[]): Promise<Response> {
  const { apiKey, baseUrl, model } = readConfig();
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenRouter 요청 실패(${resp.status}): ${txt.slice(0, 300)}`);
  }
  return resp;
}

// 비스트리밍 호출. 전체 응답 텍스트를 한 번에 돌려준다(종합/As-Is 작성용).
export async function completeChat(messages: ChatMessage[]): Promise<string> {
  const { apiKey, baseUrl, model } = readConfig();
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model, messages, stream: false, temperature: 0.2 }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenRouter 요청 실패(${resp.status}): ${txt.slice(0, 300)}`);
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("응답에 content가 없습니다");
  return content;
}
