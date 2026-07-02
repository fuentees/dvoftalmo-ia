import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Documentos - Centro de Oftalmologia Sanitária" };

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
