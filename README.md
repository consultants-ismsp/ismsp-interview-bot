# ISMS-P AI 인터뷰 챗봇 — 브릿지X

ISMS-P 인증 컨설팅의 **현황분석(As-Is) 단계**를 돕는 채팅 웹앱입니다.
AI가 가상기업 **㈜브릿지X**(선불 전자금융 서비스 '브릿지X 머니')의 부서별 **실무 담당자 페르소나**로
현황 인터뷰에 답하고, 그 대화를 모아 **As-Is 초안**을 작성합니다.

> **역할 경계**: 챗봇은 담당자처럼 *현황을 진술*하고, 작성자는 대화를 *종합*만 합니다.
> 미흡/취약 **판정(Y/P/N)·점수·집계는 컨설턴트(사람)**의 몫입니다. LLM은 진술·종합만 합니다.

## 주요 기능

- **멀티 페르소나 인터뷰** — 좌측 사이드바에서 담당자 선택(대표이사 · CISO/CPO · 정보보안팀 · 개발팀 · 운영팀 · 인프라운영팀 · 경영지원팀 · 인사팀(협력) · 가맹점관리팀(협력)). 담당자별로 **대화가 따로 보관**되어 오가도 유지됩니다.
- **자동 인터뷰** — 담당자의 체크리스트 질문을 **세부번호 순으로 한 항목씩** 순차 질문(멀티턴). 일시정지·중단·진행률 표시. 끝나면 그 대화로 **As-Is 일괄 종합**.
- **As-Is 종합(작성자)** — 인터뷰 대화에서 언급된 사실만으로 통제항목별 As-Is 초안 작성.
- **정합성 대조(답변 ↔ 원본 근거 교차 검증)** — 종합 초안 옆에 원본 As-Is(진단결과 Y/P/N)를 나란히 표시해, 담당자 답변과 정책·운영 근거가 어긋나는지 사람이 교차 검증합니다. *대조 데이터는 화면 표시 전용 — LLM에는 절대 주입하지 않습니다.*
- **라이트/다크 테마**, 구어체 질문 변환, 에러 재시도 등.

## 스택 / 버전

| 항목 | 버전 |
|---|---|
| Node | **18.20.8** (`.nvmrc`) |
| Next.js | 14.2.35 (App Router) |
| React | 18.3.1 |
| TypeScript | 5.5.4 |
| LLM | OpenRouter(OpenAI 호환), 기본 모델 `anthropic/claude-sonnet-4.6` |
| 응답 | SSE 스트리밍 |

앱 버전: `0.1.0`

## 환경변수

이 저장소에는 `.env.example`을 포함하지 않습니다. 루트에 **`.env`** 파일을 직접 만들어 아래 값을 채우세요.
모든 값은 **서버(Route Handler)에서만** 읽히며, `NEXT_PUBLIC_` 접두사는 쓰지 않습니다(붙이면 클라이언트 번들에 노출됨).

```dotenv
# OpenRouter 설정 — .env (gitignore됨, 절대 커밋 금지)
OPENROUTER_API_KEY=sk-or-...        # 본인 OpenRouter 키
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

> **키 처리**: 흐름은 브라우저 → `POST /api/chat`(서버) → OpenRouter 입니다.
> API 키는 서버에만 존재하며 클라이언트로 전송되지 않습니다.

## 셋업 & 실행

```bash
nvm use            # 18.20.8
npm install
# 루트에 .env 생성 후 OPENROUTER_API_KEY 채우기 (위 환경변수 참고)

npm run dev        # 개발 서버  → http://localhost:4000
npm run build      # 프로덕션 빌드
npm start          # 프로덕션 실행 → http://localhost:4000  (먼저 build 필요)
```

## 프로젝트 구조

```
app/
  layout.tsx
  page.tsx                  # 채팅 UI ("use client") — 사이드바·툴바·자동인터뷰·종합/대조 패널
  globals.css               # 디자인 토큰(라이트 기본/다크) + 스타일
  api/
    chat/route.ts           # 담당자 systemPrompt + 지식 주입 → OpenRouter 스트리밍 릴레이 (키는 여기서만)
    questions/route.ts       # 자동 인터뷰 질문 목록(checklist, 세부번호 순, 구어체 변환)
    synthesize/route.ts      # 인터뷰 대화 → As-Is 초안 종합(비스트리밍)
    answerkey/route.ts       # 정합성 대조용 원본 As-Is (화면 표시 전용)
lib/
  personas.ts               # 페르소나 정의 + 공통 규칙 (COMPANY_CONTEXT는 knowledge/company.ts에서 가져옴)
  knowledge.ts              # 지식 조립 헬퍼(자산/현황 주입, 체크리스트, 대조)
  knowledge/
    company.ts              # 공통 회사 컨텍스트(조직도·흐름도 기반)
    assets.json             # 부서별 보유 자산
    status.json             # 부서별 운영 현황(통제항목 단위, 세부번호 없음)
    checklist.json          # 인터뷰 질문 + 세부번호 매핑(인터뷰어/종합 기준)
    answerkey.json          # 원본 진단결과/As-Is (대조 전용, LLM 미주입)
  openrouter.ts             # OpenRouter 스트리밍/완성 래퍼(env에서 base/model/key)
  synthesizer.ts            # 작성자(종합) 시스템 프롬프트
  useInterview.ts           # 클라이언트 인터뷰 상태/동작 훅
```

## 지식 구조 (출처별 구분)

페르소나 지식은 출처가 다릅니다 — **무엇이 입력 산출물에서 오고, 무엇이 보고서 재정리이며, 무엇이 LLM에 주입되지 않는지**를 구분합니다.

- **자산·망·흐름 현황(`assets.json`, `company.ts`)** — 입력 산출물(자산대장·흐름도·조직도)에서 만듭니다.
- **운영 실태(`status.json`)** — 수준평가 현황(As-Is)을 **통제항목 단위로 재정리**한 것입니다. 단, **세부번호(1.1.2-1 등)와 진단결과(Y/P/N)는 제거**해, 담당자가 평가가 아닌 '사실'로만 진술하도록 했습니다. 여기에는 인터뷰로 드러나야 할 **의도적으로 심은 취약 시나리오**(예: 취약점 점검 미수행, 위험조치 누락 등)도 사실 형태로 포함됩니다.
- **진단결과·세부번호 매핑(`checklist.json` 질문/번호, `answerkey.json` 결과/As-Is)** — 인터뷰어·작성자·대조의 기준일 뿐, **담당자(LLM)에는 주입하지 않습니다.** 담당자는 통제번호를 모릅니다.

즉 담당자에게 주입되는 건 **`[보유 자산]`(assets) + `[운영 현황]`(status)**뿐이고, `checklist.json`은 질문으로만, `answerkey.json`은 정합성 대조 표시 전용입니다.

## 동작 흐름

```
입력 산출물(자산·흐름·조직)  →  페르소나가 아는 회사 현실(assets/status)
수준평가 통제항목            →  인터뷰 질문(checklist)
        │
   인터뷰(담당자 진술) ──────┘
        ▼
   As-Is 종합(작성자)  ──▶  원본 As-Is(answerkey)와 코드로 정합성 대조
```

## 검증 포인트

- `.env`에 키 없이 실행 → `/api/chat`가 친절한 에러 반환.
- 키 넣고 질문 → 스트리밍으로 답이 한 글자씩 들어오는지.
- 자동 인터뷰 → 세부번호 순 멀티턴 후 As-Is 일괄 종합되는지.
- 담당자 답변에 **세부번호가 안 섞이는지**, 클라이언트 번들/요청에 **API 키·answerkey가 안 실리는지**.
- `npm run build` 통과.
