import { PageHeader } from "@/components/ui/page-header";
import { DocumentLibrary } from "@/components/documents/document-library";
import { UploadPanel } from "@/components/documents/upload-panel";

export const metadata = { title: "Base de Conhecimento — DvOftalmo IA" };

export default function KnowledgeBasePage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Base de Conhecimento"
        description="Indexe documentos para consulta semântica e respostas com fontes citadas."
      />
      <div className="space-y-6 p-6">
        <UploadPanel />
        <DocumentLibrary />
      </div>
    </div>
  );
}
