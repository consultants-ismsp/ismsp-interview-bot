// 페르소나 지식 조립 헬퍼. 서버에서만 쓴다.
// 출처(입력 산출물 기반):
//   - assets.json   : 부서별 보유 자산              { personaId: Asset[] }
//   - status.json   : 부서별 운영 현황(통제항목 단위) { personaId: { 통제항목: 현황문장[] } }  ← 세부번호 없음
//   - checklist.json: 인터뷰 질문 + 세부번호 매핑      ChecklistItem[]  ← 인터뷰어/종합 기준(담당자엔 질문으로만)
//   - answerkey.json: 정합성 대조용                    { sebu: {result, asis} }  ← 페르소나/LLM 입력 금지
//
// 원칙: 담당자(페르소나)에게는 자산·현황만 주입한다. 세부번호(1.1.2-1 등)는 절대 넣지 않는다.
import assetsRaw from "@/lib/knowledge/assets.json";
import statusRaw from "@/lib/knowledge/status.json";
import checklistRaw from "@/lib/knowledge/checklist.json";
import answerkeyRaw from "@/lib/knowledge/answerkey.json";

export interface Asset {
  category: string;
  name: string;
  use: string;
  grade: string;
}

export interface ChecklistItem {
  sebu: string; // 세부번호 예 "2.8.2-2"
  area: string; // 통제영역 이름 예 "정보시스템 도입 및 개발 보안"
  control: string; // 통제항목 이름 예 "보안 요구사항 검토 및 시험"
  question: string; // 인터뷰 질문(점검문)
  persona: string; // 담당 페르소나 id
}

export interface CompareRow {
  sebu: string;
  area: string;
  control: string;
  result: string; // 진단결과 Y/P/N (대조 표시용)
  asis: string; // 원본 As-Is (대조 표시용)
}

type AssetsMap = Record<string, Asset[]>;
type StatusMap = Record<string, Record<string, string[]>>;
type AnswerKeyMap = Record<string, { result: string; asis: string }>;

const ASSETS = assetsRaw as AssetsMap;
const STATUS = statusRaw as StatusMap;
const CHECKLIST = checklistRaw as ChecklistItem[];
const ANSWERKEY = answerkeyRaw as AnswerKeyMap;

// ── 세부번호 자연 정렬 ──────────────────────────────────────
export function compareSebu(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// 감사 점검문("…하고 있는가?")을 면접관 구어체 질문("…하고 계신가요?")으로 바꾼다.
export function toInterviewQuestion(q: string): string {
  let s = q.trim().replace(/\s*\?+\s*$/, "").trim();
  const rules: [RegExp, string][] = [
    [/하고\s*있는가$/, "하고 계신가요"],
    [/되어\s*있는가$/, "되어 있나요"],
    [/돼\s*있는가$/, "돼 있나요"],
    [/수행하고\s*있는가$/, "수행하고 계신가요"],
    [/있는가$/, "있나요"],
    [/하는가$/, "하시나요"],
    [/되는가$/, "되나요"],
    [/인가$/, "인가요"],
    [/한가$/, "한가요"],
  ];
  for (const [re, rep] of rules) {
    if (re.test(s)) {
      s = s.replace(re, rep);
      break;
    }
  }
  return s + "?";
}

// ── 자산 / 현황 ─────────────────────────────────────────────
export function getAssets(personaId: string): Asset[] {
  return ASSETS[personaId] ?? [];
}

export function getStatus(personaId: string): Record<string, string[]> {
  return STATUS[personaId] ?? {};
}

// ── 인터뷰 체크리스트 ───────────────────────────────────────
// 담당자의 점검문을 세부번호 순으로. (인터뷰어/종합 기준 — 담당자 프롬프트엔 넣지 않는다.)
export function getChecklist(personaId: string): ChecklistItem[] {
  return CHECKLIST.filter((c) => c.persona === personaId).sort((a, b) => compareSebu(a.sebu, b.sebu));
}

// 세부번호 목록 → 그 항목들이 속한 통제항목(control) 이름 집합.
// 자동 인터뷰에서 "이 항목" 현황만 주입할 때 쓴다.
function controlsForSebus(personaId: string, sebuList: string[]): Set<string> {
  const set = new Set(sebuList);
  const controls = new Set<string>();
  for (const c of CHECKLIST) {
    if (c.persona === personaId && set.has(c.sebu)) controls.add(c.control);
  }
  return controls;
}

// 통제영역 이름(부분일치) → 그 영역의 통제항목 이름 집합. (종합 범위 한정용)
function controlsForArea(personaId: string, area: string): Set<string> {
  const needle = area.trim();
  const controls = new Set<string>();
  for (const c of CHECKLIST) {
    if (c.persona === personaId && c.area.includes(needle)) controls.add(c.control);
  }
  return controls;
}

// ── 페르소나 지식 블록 ──────────────────────────────────────
// systemPrompt 뒤에 붙일 [보유 자산] + [운영 현황] 텍스트.
//  - sebuList가 오면(자동 인터뷰) 그 항목의 통제항목 현황만.
//  - area가 오면(종합 등) 그 영역 통제항목 현황만.
//  - 둘 다 없으면(수동 채팅) 그 담당자 전체 현황.
// 어떤 경우에도 세부번호는 넣지 않는다.
export function buildKnowledgeBlock(
  personaId: string,
  opts: { sebuList?: string[]; area?: string } = {},
): string {
  const parts: string[] = [];

  const assets = getAssets(personaId);
  if (assets.length) {
    const lines = assets.map((a) => `- ${a.name}(${a.grade}): ${a.use}`);
    parts.push(`[보유 자산]\n${lines.join("\n")}`);
  }

  const status = getStatus(personaId);
  let controls = Object.keys(status);
  if (opts.sebuList && opts.sebuList.length) {
    const wanted = controlsForSebus(personaId, opts.sebuList);
    controls = controls.filter((c) => wanted.has(c));
  } else if (opts.area) {
    const wanted = controlsForArea(personaId, opts.area);
    controls = controls.filter((c) => wanted.has(c));
  }
  if (controls.length) {
    const lines = controls.map((c) => `- ${c}: ${status[c].join(" / ")}`);
    parts.push(
      `[운영 현황] (아래 사실에 근거해서만 답하고, 없는 내용은 "확인이 필요합니다"로)\n${lines.join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

// ── 정합성 대조(answerkey) ──────────────────────────────────
// 담당자 checklist에 원본 진단결과/As-Is를 join해 대조 행을 만든다.
// 주의: 이 데이터는 '화면 표시(대조)' 전용이다. 페르소나/LLM 입력에는 절대 넣지 않는다.
export function getCompareRows(personaId: string, area?: string): CompareRow[] {
  let items = getChecklist(personaId);
  if (area && area.trim()) {
    const needle = area.trim();
    items = items.filter((c) => c.area.includes(needle));
  }
  return items.map((c) => {
    const ak = ANSWERKEY[c.sebu];
    return {
      sebu: c.sebu,
      area: c.area,
      control: c.control,
      result: ak?.result ?? "",
      asis: ak?.asis ?? "",
    };
  });
}

// ── 종합(작성자)용 질문 목록 ────────────────────────────────
// 인터뷰어/작성자가 어떤 항목을 채울지 가이드로 쓴다. (세부번호 표기 포함 — 컨설턴트 쪽이라 허용)
export function buildQuestionList(personaId: string, area?: string): string {
  let items = getChecklist(personaId);
  if (area && area.trim()) {
    const needle = area.trim();
    items = items.filter((c) => c.area.includes(needle));
  }
  if (!items.length) return "";
  return items.map((c) => `- (${c.sebu}) ${c.control}: ${c.question}`).join("\n");
}
