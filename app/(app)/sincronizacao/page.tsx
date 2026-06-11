import { Database } from "lucide-react";
import { CevespSyncCard } from "@/components/settings/cevesp-sync-card";
import { SinanTracomaSyncCard } from "@/components/settings/sinan-tracoma-sync-card";

export const metadata = { title: "Sincronização de Dados" };

export default function SincronizacaoPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Database className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Sincronização de Dados</h1>
          <p className="text-sm text-muted-foreground">
            Mantenha os caches do Supabase atualizados com os bancos MySQL da rede SES-SP.
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Como funciona:</strong> os bancos MySQL ficam na rede interna SES-SP (192.168.x.x)
        e não são acessíveis pelo Vercel. Para usar dados reais nos agentes, exporte o banco
        dentro da rede e depois importe aqui de qualquer lugar.
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <CevespSyncCard />
        <SinanTracomaSyncCard />
      </div>
    </div>
  );
}
