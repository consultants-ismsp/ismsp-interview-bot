"use client";

import { useEffect, useRef, useState } from "react";
import { PERSONAS } from "@/lib/personas";
import { useInterview } from "@/lib/useInterview";

export default function Page() {
  // 도메인 상태/동작은 모두 훅이 관리한다. 여기는 화면(입력·테마·스크롤)만 다룬다.
  const {
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
  } = useInterview();

  const [input, setInput] = useState("");
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 새 메시지/토큰이 들어올 때마다 맨 아래로.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 담당자를 바꾸면 입력창을 비운다.
  useEffect(() => {
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
  }, [personaId]);

  // 다크 테마 토글(기본은 라이트).
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
  }

  // textarea 높이 자동 조절.
  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 전송, Shift+Enter 줄바꿈.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    await send(text);
  }

  function clearChat() {
    reset();
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(synth.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="name">
            브릿지X 머니
            <small>ISMS-P 현황 인터뷰</small>
          </span>
        </div>

        <div className="side-label">담당자 선택</div>
        <nav className="persona-list">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`persona-item ${p.id === personaId ? "on" : ""}`}
              onClick={() => selectPersona(p.id)}
              disabled={busy}
              title={p.scope}
            >
              <span className="pname">{p.name}</span>
              <span className="pdept">{p.dept}</span>
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <button className="themebtn" onClick={toggleTheme} title="테마 전환">
            {dark ? "☀️ 라이트" : "🌙 다크"}
          </button>
        </div>
      </aside>

      <div className="chat-shell">
        <main className="chat-main">
          <div className="chat-bar">
            <div className="cb-persona">
              <b>{persona?.name ?? "담당자"}</b>
              <span>{persona?.scope ?? "현황 진술"}</span>
            </div>
            <span className="spacer" />
            {autoRunning ? (
              <div className="auto-controls">
                <span className="auto-prog">
                  자동 인터뷰 {autoProgress.done}/{autoProgress.total}
                  {autoPaused ? " · 일시정지" : ""}
                </span>
                <button className="cb-btn" onClick={togglePauseAuto}>
                  {autoPaused ? "재개" : "일시정지"}
                </button>
                <button className="cb-btn ghost" onClick={stopAuto}>
                  중단
                </button>
              </div>
            ) : (
              <>
                <button
                  className="cb-btn"
                  onClick={() => void startAutoInterview()}
                  disabled={busy || synth.busy}
                  title="이 담당자의 전체 항목을 세부번호 순으로 자동 질문 후 일괄 종합"
                >
                  자동 인터뷰 ▶
                </button>
                <button
                  className="cb-btn"
                  onClick={() => void synthesize()}
                  disabled={busy || synth.busy || !hasTranscript}
                  title={hasTranscript ? "현재 대화로 As-Is 현황 초안을 작성" : "먼저 담당자와 대화를 나누세요"}
                >
                  {synth.busy ? "종합 중…" : "As-Is 종합"}
                </button>
                <button className="cb-btn ghost" onClick={clearChat} disabled={busy || messages.length === 0}>
                  대화 초기화
                </button>
              </>
            )}
          </div>
          <div className="demonote">
            자기 범위 안에서만 <b>현황을 진술</b>하고, 미흡/취약 판정·집계는 하지 않습니다(그건 컨설턴트의 몫).
          </div>

          <div className="messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="empty-hint">
                <b>{persona?.name ?? "담당자"}에게 물어보세요</b>
                현황분석 인터뷰 질문을 입력하면
                <br />
                {persona?.name ?? "담당자"} 페르소나로 답합니다.
              </div>
            ) : (
              messages.map((m, i) => {
                const last = i === messages.length - 1;
                const streaming = last && m.role === "assistant" && busy && !m.error;
                const rowClass = m.error ? "error" : m.role;
                return (
                  <div key={i} className={`bubble-row ${rowClass}`}>
                    <div className="bubble">
                      {m.role === "assistant" && !m.error && (
                        <div className="who">{persona?.name ?? "담당자"}</div>
                      )}
                      {m.content}
                      {streaming && <span className="caret" />}
                      {m.error && last && !busy && (
                        <button className="retry" onClick={() => void retry()}>
                          재시도
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>

        <div className="composer">
          <div className="inner">
            <div className="row">
              <textarea
                ref={taRef}
                value={input}
                onChange={onInput}
                onKeyDown={onKeyDown}
                placeholder={autoRunning ? "자동 인터뷰 진행 중…" : "예) 접근통제는 현재 어떻게 운영하고 있나요?"}
                rows={1}
                disabled={busy}
              />
              <button className="btn send" onClick={() => void submit()} disabled={busy || !input.trim()}>
                {sending ? "전송 중…" : "전송"}
              </button>
            </div>
            <div className="foot">
              <span className="tip">Enter 전송 · Shift+Enter 줄바꿈</span>
            </div>
          </div>
        </div>
      </div>

      {synth.open && (
        <div className="synth-overlay" onClick={closeSynth}>
          <div className="synth-panel" onClick={(e) => e.stopPropagation()}>
            <div className="synth-head">
              <div>
                <b>As-Is 종합 초안</b>
                <span className="sub">
                  {persona?.name ?? "담당자"}
                  {area.trim() ? ` · 통제영역 ${area.trim()}` : ""}
                </span>
              </div>
              <button className="x" onClick={closeSynth} title="닫기">
                ✕
              </button>
            </div>

            <div className="synth-scope">
              <input
                className="area-input"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="통제영역 이름(선택) 예: 암호화 적용 — 비우면 대화 전체로 종합"
                disabled={synth.busy}
              />
              <button className="btn" onClick={() => void synthesize()} disabled={synth.busy || !hasTranscript}>
                {synth.busy ? "종합 중…" : "다시 종합"}
              </button>
            </div>

            {synth.error ? (
              <div className="err">{synth.error}</div>
            ) : synth.busy ? (
              <div className="synth-loading">대화에서 현황을 종합하는 중…</div>
            ) : (
              <>
                <div className={`synth-body ${compareRows ? "split" : ""}`}>
                  <div className="synth-col">
                    <div className="col-head">종합 초안 (인터뷰 기반)</div>
                    <textarea className="synth-text" value={synth.draft} readOnly />
                  </div>
                  {compareRows && (
                    <div className="synth-col">
                      <div className="col-head">원본 As-Is (대조용 · LLM 미사용)</div>
                      <div className="compare-list">
                        {compareRows.length === 0 ? (
                          <div className="compare-empty">대조할 원본 항목이 없습니다.</div>
                        ) : (
                          compareRows.map((r) => (
                            <div key={r.sebu} className="compare-row">
                              <div className="cr-head">
                                <span className="cr-sebu">{r.sebu}</span>
                                <span className="cr-ctrl">{r.control}</span>
                                {r.result && (
                                  <span className={`cr-result r-${r.result}`}>{r.result}</span>
                                )}
                              </div>
                              <div className="cr-asis">{r.asis || "(원본 As-Is 없음)"}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="synth-actions">
                  <span className="note">판정은 사람 몫</span>
                  <span className="spacer" />
                  <button className="btn secondary" onClick={() => void toggleCompare()}>
                    {compareRows ? "대조닫기" : "대조"}
                  </button>
                  <button className="btn secondary" onClick={() => void copyDraft()}>
                    {copied ? "복사됨" : "복사"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
