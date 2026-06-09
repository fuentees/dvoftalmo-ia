import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { QueryProvider } from "@/lib/query-client";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DvOftalmo IA",
  description: "Agente inteligente de vigilância epidemiológica das conjuntivites — COS/DVSE/CVS SP",
  manifest: "/manifest.json",
  themeColor: "#1a6654",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "DvOftalmo IA" },
  viewport: { width: "device-width", initialScale: 1 }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('dvoftalmo_theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}})()` }} />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
