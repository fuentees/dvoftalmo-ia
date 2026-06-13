import type { Metadata, Viewport } from "next";
import { QueryProvider } from "@/lib/query-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "DvOftalmo IA",
  description: "Agente inteligente de vigilância epidemiológica para oftalmologia sanitária - COS/DVSE/CVS SP",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "DvOftalmo IA" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1a6654"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('dvoftalmo_theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
