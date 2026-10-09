import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/ui/page-header";
import { UploadPanel } from "@/components/documents/upload-panel";

export const metadata = { title: "Documentos - Centro de Oftalmologia Sanitária" };

export default function DocumentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Documentos"
        description="Biblioteca de arquivos oficiais com categorias, tags, favoritos e busca."
      />
      <div className="space-y-6">
        <UploadPanel />
        <DocumentLibrary />
      </div>
    </div>
  );
}
