import { Suspense } from "react";
import { BulletinsView } from "@/components/boletins/bulletins-view";

export const metadata = { title: "Boletins Epidemiológicos" };

export default function BoletinsPage() {
  return (
    <Suspense>
      <BulletinsView />
    </Suspense>
  );
}
