import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "分账本",
  description: "导入银行账单，和同学分账",
  appleWebApp: { capable: true, title: "分账本", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9edf3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f141c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=DM+Mono:wght@500&display=swap"
        />
      </head>
      <body className="min-h-dvh pb-24">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
