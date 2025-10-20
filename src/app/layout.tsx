import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portfolio Viewer",
  description: "Solana wallet performance viewer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var mql=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');var prefersDark=mql?mql.matches:null;var stored=null;try{stored=localStorage.getItem('theme');}catch(e){}var useDark=stored?stored==='dark':(prefersDark!==null?prefersDark:true);var root=document.documentElement;root.classList.toggle('dark',useDark);}catch(e){document.documentElement.classList.add('dark');}})();`}
        </Script>
        <div className="min-h-dvh bg-background text-foreground">
          <header className="py-4 text-center border-b border-border">
            <Link href="/" className="text-xl font-semibold">
              CasaLP
            </Link>
          </header>
          {children}
          <Analytics />
        </div>
      </body>
    </html>
  );
}
