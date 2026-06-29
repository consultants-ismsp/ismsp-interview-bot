"use client";

// 인터뷰 도메인 상태/동작을 한곳에 모은 훅.
// 화면(page.tsx)은 이 훅이 돌려주는 상태와 액션만 쓰면 된다.
// - 담당자별 대화 보관(convos), 수동 전송, 자동 인터뷰, As-Is 종합
// - 스트리밍 코어(streamChatTurn)는 수동/자동이 공유한다.
import { useEffect, useRef, useState } from "react";
import { DEFAULT_PERSONA_ID, getPersona } from "@/lib/personas";

export type Role = "user" | "assistant";
export interface Msg {
  role: Role;
  content: string;
  error?: boolean; // 에러 말풍선 표시용
}

interface Question {
  sebu: string;
  control: string;
  question: string;
}

interface LastTurn {
  history: Msg[];
  sebuList?: string[];
}

export interface SynthState {
  open: boolean;
  busy: boolean;
  draft: string;
  error: string;
}

// 정합성 대조 행(화면 표시 전용). 서버 /api/answerkey 응답 형태와 같다.
export interface CompareRow {
  sebu: string;
  area: string;
  control: string;
  result: string;
  asis: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 에러 응답에서 사람이 읽을 메시지를 뽑는다.
async function readError(resp: Response): Promise<string> {
  try {
    const json = await resp.json();
    if (json?.error) return json.error;
  } catch {
    /* JSON이 아니면 아래로 */
  }
  return `요청 실패 (${resp.status})`;
}

export function useInterview() {
  // 담당자별로 대화를 따로 보관한다. 담당자를 바꿔도 각자 대화가 남는다.
  const [convos, setConvos] = useState<Record<string, Msg[]>>({});
  const [sending, setSending] = useState(false);
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA_ID);
  const [area, setArea] = useState("");

  // 자동 인터뷰 상태.
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [autoProgress, setAutoProgress] = useState({ done: 0, total: 0 });
  const autoStopRef = useRef(false);
  const autoPauseRef = useRef(false);

  // 진행 중 스트림 중단용 + 직전 턴(재시도용).
  const abortRef = useRef<AbortController | null>(null);
  const lastTurnRef = useRef<LastTurn | null>(null);

  // As-Is 종합 패널.
  const [synth, setSynth] = useState<SynthState>({
    open: false,
    busy: false,
    draft: "",
    error: "",
  });

  // 정합성 대조(원본 As-Is) — 켜면 종합 초안 옆에 나란히 표시. null이면 꺼짐.
  const [compareRows, setCompareRows] = useState<CompareRow[] | null>(null);

  const busy = sending || autoRunning;
  const persona = getPersona(personaId);
  const messages = convos[personaId] ?? [];
  const hasTranscript = messages.some((m) => !m.error);

  // 담당자가 바뀌면 종합 영역 한정은 초기화한다(다른 담당자 범위로 새로 시작).
  useEffect(() => {
    setArea("");
  }, [personaId]);

  // 현재 담당자의 대화만 갱신한다(배열 또는 (prev)=>next 둘 다 지원).
  // busy 동안은 담당자 전환이 막혀 personaId가 안정적이다.
  function setMessages(updater: Msg[] | ((prev: Msg[]) => Msg[])) {
    setConvos((all) => {
      const prev = all[personaId] ?? [];
      const next = typeof updater === "function" ? updater(prev) : updater;
      return { ...all, [personaId]: next };
    });
  }

  // 마지막(assistant) 말풍선 내용 갱신.
  function updateLast(content: string) {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = { role: "assistant", content };
      return next;
    });
  }

  // 마지막 빈 말풍선을 에러 말풍선으로 교체.
  function showError(message: string) {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = { role: "assistant", content: message, error: true };
      return next;
    });
  }

  function reset() {
    if (busy) return;
    setMessages([]);
  }

  // 담당자 전환. 대화는 담당자별로 보관되므로 지우지 않는다(돌아오면 남아있음).
  function selectPersona(id: string) {
    if (busy || id === personaId) return;
    setPersonaId(id);
  }

  // /api/chat에 한 턴을 보내 스트리밍 응답을 마지막(빈) assistant 말풍선에 누적한다.
  // 호출 전에 history(user 포함) + 빈 assistant 말풍선이 이미 그려져 있어야 한다.
  // 누적 답변을 반환하고, 실패하면 에러 말풍선으로 바꾼 뒤 null을 반환한다.
  // 중단(abort) 시에는 그때까지 받은 부분 답변을 반환한다.
  async function streamChatTurn(
    history: Msg[],
    opts: { sebuList?: string[] },
  ): Promise<string | null> {
    lastTurnRef.current = { history, sebuList: opts.sebuList };
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          personaId,
          area: area.trim() || undefined,
          sebuList: opts.sebuList,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!resp.ok || !resp.body) {
        showError(await readError(resp));
        return null;
      }

      // SSE 스트림을 읽어 마지막 assistant 말풍선에 토큰을 누적.
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE는 "\n\n"으로 이벤트가 구분된다.
        const events = buf.split("\n\n");
        buf = events.pop() ?? ""; // 마지막 조각은 미완성일 수 있어 남겨둔다.

        for (const evt of events) {
          for (const line of evt.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === "string") {
                acc += delta;
                updateLast(acc);
              }
            } catch {
              // OpenRouter가 가끔 보내는 주석/keep-alive 라인 등은 무시.
            }
          }
        }
      }

      // 끝났는데 한 글자도 못 받았으면 안내.
      if (!acc) {
        updateLast("(응답이 비어 있습니다)");
        return "(응답이 비어 있습니다)";
      }
      return acc;
    } catch (e) {
      // 사용자가 중단(abort)한 경우: 부분 답변을 그대로 둔다(에러 아님).
      if ((e as Error).name === "AbortError") {
        if (!acc) updateLast("(중단됨)");
        return acc;
      }
      showError((e as Error).message ?? "네트워크 오류가 발생했습니다");
      return null;
    } finally {
      abortRef.current = null;
    }
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;

    const history = [...messages.filter((m) => !m.error), { role: "user" as Role, content: t }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setSending(true);
    try {
      await streamChatTurn(history, {});
    } finally {
      setSending(false);
    }
  }

  // 마지막 턴(직전 질문 + 주입 범위)을 그대로 다시 보낸다(에러 후 재시도).
  async function retry() {
    if (busy || !lastTurnRef.current) return;
    const { history, sebuList } = lastTurnRef.current;
    setMessages([...history, { role: "assistant", content: "" }]);
    setSending(true);
    try {
      await streamChatTurn(history, { sebuList });
    } finally {
      setSending(false);
    }
  }

  // ── 자동 인터뷰 ───────────────────────────────────────────
  // 담당자(+영역)의 질문을 세부번호 순으로 한 턴씩 순차 진행한다.
  // 각 턴은 그 항목의 현황만 주입(sebuList:[sebu])해 묻는 것만 답하게 한다.
  async function startAutoInterview() {
    if (busy) return;

    // 질문 목록을 받아온다(세부번호 순 정렬은 서버에서 처리).
    let questions: Question[] = [];
    try {
      const qs = new URLSearchParams({ personaId });
      if (area.trim()) qs.set("area", area.trim());
      const resp = await fetch(`/api/questions?${qs.toString()}`);
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json) {
        alert(json?.error ?? `질문 목록을 불러오지 못했습니다 (${resp.status})`);
        return;
      }
      questions = json.items ?? [];
    } catch (e) {
      alert((e as Error).message ?? "질문 목록 요청 중 오류가 발생했습니다");
      return;
    }

    if (questions.length === 0) {
      alert(
        area.trim()
          ? `${persona?.name ?? "담당자"}의 통제영역 ${area.trim()}에 해당하는 질문이 없습니다.`
          : `${persona?.name ?? "담당자"}에게 자동 인터뷰할 질문이 없습니다.`,
      );
      return;
    }

    autoStopRef.current = false;
    autoPauseRef.current = false;
    setAutoPaused(false);
    setAutoRunning(true);
    setAutoProgress({ done: 0, total: questions.length });

    // 이어붙일 작업 배열(상태는 비동기라 로컬로 들고 간다).
    let working: Msg[] = messages.filter((m) => !m.error);

    for (let i = 0; i < questions.length; i++) {
      if (autoStopRef.current) break;
      // 일시정지면 풀릴 때까지 대기.
      while (autoPauseRef.current && !autoStopRef.current) await sleep(200);
      if (autoStopRef.current) break;

      const q = questions[i];
      working = [...working, { role: "user", content: q.question }];
      setMessages([...working, { role: "assistant", content: "" }]);

      const acc = await streamChatTurn(working, { sebuList: [q.sebu] });
      if (autoStopRef.current) break; // 중단됨(부분 답변은 화면에 남김).
      if (acc === null) break; // 에러 말풍선 표시됨. 자동 진행 중단.
      working = [...working, { role: "assistant", content: acc }];
      setAutoProgress({ done: i + 1, total: questions.length });
    }

    const stopped = autoStopRef.current;
    setAutoRunning(false);
    setAutoPaused(false);
    autoPauseRef.current = false;

    // 정상 종료면 모인 대화로 바로 As-Is 종합.
    const tx = working.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    if (!stopped && tx.length > 0) {
      void synthesize(tx);
    }
  }

  function togglePauseAuto() {
    const next = !autoPaused;
    setAutoPaused(next);
    autoPauseRef.current = next;
  }

  function stopAuto() {
    autoStopRef.current = true;
    autoPauseRef.current = false;
    setAutoPaused(false);
    abortRef.current?.abort(); // 진행 중인 스트림을 즉시 끊는다.
  }

  // 현재 담당자/영역의 대화로 As-Is 초안을 종합한다.
  // override가 있으면(자동 인터뷰 종료 직후) 그 대화 로그로 종합한다.
  async function synthesize(override?: { role: Role; content: string }[]) {
    if (synth.busy) return;
    const transcript =
      override ??
      messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    if (transcript.length === 0) return;

    setSynth({ open: true, busy: true, draft: "", error: "" });
    setCompareRows(null); // 새 종합 시작 시 대조는 접는다.

    try {
      const resp = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, area: area.trim() || undefined, transcript }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json) {
        setSynth((s) => ({ ...s, busy: false, error: json?.error ?? `종합 실패 (${resp.status})` }));
        return;
      }
      setSynth((s) => ({ ...s, busy: false, draft: json.draft ?? "" }));
    } catch (e) {
      setSynth((s) => ({ ...s, busy: false, error: (e as Error).message ?? "종합 중 오류가 발생했습니다" }));
    }
  }

  function closeSynth() {
    setSynth((s) => ({ ...s, open: false }));
    setCompareRows(null);
  }

  // 정합성 대조 토글: 켜져 있으면 끄고, 꺼져 있으면 원본 As-Is를 불러와 나란히 표시한다.
  // (answerkey 데이터는 화면 표시 전용 — LLM/페르소나에는 절대 들어가지 않는다.)
  async function toggleCompare() {
    if (compareRows) {
      setCompareRows(null);
      return;
    }
    try {
      const qs = new URLSearchParams({ personaId });
      if (area.trim()) qs.set("area", area.trim());
      const resp = await fetch(`/api/answerkey?${qs.toString()}`);
      const json = await resp.json().catch(() => null);
      setCompareRows(Array.isArray(json?.rows) ? json.rows : []);
    } catch {
      setCompareRows([]);
    }
  }

  return {
    // 상태
    personaId,
    persona,
    messages,
    area,
    setArea,
    sending,
    autoRunning,
    autoPaused,
    autoProgress,
    busy,
    hasTranscript,
    synth,
    compareRows,
    // 액션
    selectPersona,
    reset,
    send,
    retry,
    startAutoInterview,
    togglePauseAuto,
    stopAuto,
    synthesize,
    closeSynth,
    toggleCompare,
  };
}
