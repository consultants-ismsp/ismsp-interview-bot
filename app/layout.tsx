import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISMS-P 현황 인터뷰 챗봇 — 브릿지X 머니",
  description: "AI가 보안담당자 페르소나로 ISMS-P 현황 인터뷰에 답하는 채팅 데모",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
