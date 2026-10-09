import { CevespSyncCard } from "@/components/settings/cevesp-sync-card";
import { IbgePopulationCard } from "@/components/settings/ibge-population-card";
import { SinanTracomaSyncCard } from "@/components/settings/sinan-tracoma-sync-card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Sincronização de Dados" };

const PASSOS = [
  {
    onde: "1 · no escritório",
    titulo: "Exportar da rede SES",
    detalhe: "Os bancos MySQL ficam na rede interna e não são acessíveis pelo Vercel.",
    comando: "npm run sync-export"
  },
  {
    onde: "2 · em rede com acesso",
    titulo: "Importar o arquivo gerado",
    detalhe: "Registros existentes são atualizados e os novos, adicionados.",
    comando: "npm run sync-import"
  },
  {
    onde: "3 · aqui",
    titulo: "Conferir se os totais batem com a origem",
    detalhe: "Os erros novos aparecem sozinhos na Qualidade dos dados.",
    comando: null
  }
];

export default function SincronizacaoPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Sincronização"
        description="O site lê uma cópia das bases. Aqui você vê se a cópia está em dia e atualiza quando precisar."
      />

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-[17px] font-semibold">Como atualizar o CEVESP</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {PASSOS.map((passo) => (
            <li key={passo.onde} className="flex flex-col gap-1.5 rounded-lg border p-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">{passo.onde}</span>
              <span className="text-sm font-semibold">{passo.titulo}</span>
              <span className="text-[13px] text-muted-foreground">{passo.detalhe}</span>
              {passo.comando && (
                <code className="mt-auto w-fit rounded-md bg-muted px-2 py-1 font-mono text-[13px]">{passo.comando}</code>
              )}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <CevespSyncCard />
        <div className="flex flex-col gap-6">
          <SinanTracomaSyncCard />
          <IbgePopulationCard />
        </div>
      </div>
    </div>
  );
}
