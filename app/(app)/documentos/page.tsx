import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Documentos - Centro de Oftalmologia Sanitária" };

export default function DocumentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Documentos"
        description="Protocolos, notas técnicas, circulares e ofícios em um só lugar."
      />
      <DocumentLibrary />
    </div>
  );
}
