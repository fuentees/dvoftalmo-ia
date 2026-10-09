import {
  Activity,
  Bell,
  CheckSquare,
  ClipboardList,
  Database,
  Eye,
  LayoutDashboard,
  Library,
  Map,
  Newspaper,
  ShieldAlert
} from "lucide-react";

export const navigationGroups = [
  {
    label: "Monitoramento",
    items: [
      { href: "/dashboard", label: "Sala de Situação", description: "Mapa geral, resumo e prioridades", icon: LayoutDashboard },
      { href: "/alertas", label: "Alertas", description: "Eventos que pedem investigação", icon: Bell },
      { href: "/territorios", label: "Territórios", description: "Ranking operacional por município e GVE", icon: Map }
    ]
  },
  {
    label: "Agravos",
    items: [
      { href: "/conjuntivite", label: "Conjuntivite", description: "Situação, qualidade e consulta do CEVESP", icon: Eye },
      { href: "/tracoma", label: "Tracoma", description: "TRACONET e NOTTRACONET (SINAN)", icon: Activity }
    ]
  },
  {
    label: "Dados",
    items: [
      { href: "/qualidade-dados", label: "Qualidade dos dados", description: "Pendências por quem resolve", icon: ShieldAlert },
      { href: "/correcoes", label: "Correções", description: "Aprovar e aplicar ajustes nos dados", icon: CheckSquare },
      { href: "/boletins", label: "Boletins", description: "Produção e histórico técnico", icon: Newspaper }
    ]
  },
  {
    label: "Sistema",
    items: [
      { href: "/sincronizacao", label: "Sincronização", description: "Atualizar CEVESP, TRACONET e NOTTRACONET", icon: Database },
      { href: "/auditoria", label: "Auditoria", description: "Histórico de ações do sistema", icon: ClipboardList },
      { href: "/documentos", label: "Documentos", description: "Arquivos e documentos oficiais", icon: Library }
    ]
  }
];
