import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Savant",
  description: "AI-powered RAG audio analysis for research papers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
