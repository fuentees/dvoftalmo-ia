import { PageHeader } from "@/components/ui/page-header";
import { DocumentLibrary } from "@/components/documents/document-library";

export const metadata = { title: "Documentos — DvOftalmo IA" };

export default function DocumentsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Documentos"
        description="Biblioteca de arquivos com categorias, tags, favoritos e busca semântica."
      />
      <div className="p-6">
        <DocumentLibrary />
      </div>
    </div>
  );
}
