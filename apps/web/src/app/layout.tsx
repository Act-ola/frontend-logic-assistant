import type { Metadata } from "next";
import { FluidBackground } from "@/components/fluid-background";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontend Logic Assistant",
  description: "Evidence-first React logic Q&A for product and QA teams"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <FluidBackground />
        {children}
      </body>
    </html>
  );
}
