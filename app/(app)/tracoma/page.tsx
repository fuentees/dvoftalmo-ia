import { Suspense } from "react";
import { TracomaHubView } from "@/components/tracoma/tracoma-hub-view";

export const metadata = { title: "Tracoma — SINAN" };

export default function TracomaPage() {
  return (
    <Suspense>
      <TracomaHubView />
    </Suspense>
  );
}
