import { SidebarContent } from "@/components/navigation/sidebar-content";

export function AppSidebar() {
  return (
    <aside className="sticky top-0 h-[calc(100vh/var(--escala,1))] w-64 shrink-0">
      <SidebarContent />
    </aside>
  );
}
