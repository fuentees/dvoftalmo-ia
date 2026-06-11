import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — desktop */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header + drawer */}
        <MobileNav />

        {/* Page content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          {children}
        </main>
        <OnboardingTour />
      </div>
    </div>
  );
}
