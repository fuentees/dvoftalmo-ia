import {
  Activity,
  Bell,
  Bot,
  Brain,
  CheckSquare,
  ClipboardList,
  Database,
  Eye,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Map,
  Newspaper,
  Settings,
  ShieldAlert
} from "lucide-react";

export const navigationGroups = [
  {
    label: "Monitoramento",
    items: [
      {
        href: "/dashboard",
        label: "Sala de Situação",
        description: "Mapa geral, resumo e prioridades",
        icon: LayoutDashboard
      },
      {
        href: "/alertas",
        label: "Alertas",
        description: "Eventos que pedem investigação",
        icon: Bell
      }
    ]
  },
  {
    label: "Análises",
    items: [
      {
        href: "/conjuntivite",
        label: "Conjuntivite — CEVESP",
        description: "Análise epidemiológica e qualidade dos dados",
        icon: Eye
      },
      {
        href: "/tracoma",
        label: "Tracoma — SINAN",
        description: "TRACONET, NOTTRACONET e qualidade dos dados",
        icon: Activity
      },
      {
        href: "/territorios",
        label: "Territórios",
        description: "Ranking operacional por município e GVE",
        icon: Map
      },
      {
        href: "/qualidade-dados",
        label: "Qualidade dos Dados",
        description: "Pendências que afetam a decisão",
        icon: ShieldAlert
      }
    ]
  },
  {
    label: "Execução",
    items: [
      {
        href: "/correcoes",
        label: "Correções",
        description: "Revisar e aplicar ajustes nos dados",
        icon: CheckSquare
      },
      {
        href: "/boletins",
        label: "Boletins",
        description: "Produção e histórico técnico",
        icon: Newspaper
      },
      {
        href: "/chat",
        label: "Chat com IA",
        description: "Perguntas livres e geração de relatórios",
        icon: Bot
      },
      {
        href: "/templates",
        label: "Modelos",
        description: "Ofícios, relatórios e e-mails",
        icon: FileText
      }
    ]
  },
  {
    label: "Sistema",
    items: [
      {
        href: "/sincronizacao",
        label: "Sincronização",
        description: "Importar CEVESP, TRACONET e NOTTRACONET",
        icon: Database
      },
      {
        href: "/auditoria",
        label: "Auditoria",
        description: "Histórico de ações do sistema",
        icon: ClipboardList
      },
      {
        href: "/agentes",
        label: "Agentes IA",
        description: "Ferramentas de análise especializadas",
        icon: GraduationCap
      },
      {
        href: "/base-conhecimento",
        label: "Base de Conhecimento",
        description: "Documentos para contexto da IA",
        icon: Brain
      },
      {
        href: "/documentos",
        label: "Documentos",
        description: "Arquivos e documentos oficiais",
        icon: Library
      },
      {
        href: "/configuracoes",
        label: "Configurações",
        description: "Provedor, modelo e chaves de API",
        icon: Settings
      }
    ]
  }
];
