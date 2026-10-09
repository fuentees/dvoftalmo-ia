import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/ui/page-header";
import { UploadPanel } from "@/components/documents/upload-panel";

export const metadata = { title: "Documentos - Centro de Oftalmologia Sanitária" };

export default function DocumentsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Documentos"
        description="Biblioteca de arquivos oficiais com categorias, tags, favoritos e busca."
      />
      <div className="space-y-6 p-6">
        <UploadPanel />
        <DocumentLibrary />
      </div>
    </div>
  );
}
