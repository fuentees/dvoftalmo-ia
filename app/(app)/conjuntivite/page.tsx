import { Suspense } from "react";
import { ConjuntiviteHubView } from "@/components/conjuntivite/conjuntivite-hub-view";

export const metadata = { title: "Conjuntivite — CEVESP" };

export default function ConjuntivitePage() {
  return (
    <Suspense>
      <ConjuntiviteHubView />
    </Suspense>
  );
}
