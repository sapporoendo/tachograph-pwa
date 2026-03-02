import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "タコグラフ撮影",
  description: "タコグラフ画像収集用PWA",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "タコグラフ",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head><link rel="apple-touch-icon" href="/icon-192.png" /></head>
      <body className="bg-slate-900 text-white antialiased">{children}</body>
    </html>
  );
}
