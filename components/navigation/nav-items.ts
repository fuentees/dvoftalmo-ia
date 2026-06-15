import {
  BarChart3,
  Bell,
  Bot,
  Brain,
  CheckSquare,
  ClipboardList,
  Database,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Newspaper,
  Settings,
  ShieldAlert
} from "lucide-react";

export const navigationGroups = [
  {
    label: "Início",
    items: [
      {
        href: "/dashboard",
        label: "Sala de Situação",
        description: "Visão geral, mapas e prioridades",
        icon: LayoutDashboard
      }
    ]
  },
  {
    label: "Análises",
    items: [
      {
        href: "/notificacoes",
        label: "Conjuntivites - CEVESP",
        description: "Consulta, canal endêmico e boletim",
        icon: BarChart3
      },
      {
        href: "/sinan-qualidade",
        label: "Tracoma - SINAN",
        description: "TRACONET, NOTTRACONET e qualidade",
        icon: ShieldAlert
      },
      {
        href: "/alertas",
        label: "Alertas e Resposta",
        description: "Eventos que pedem investigação",
        icon: Bell
      },
      {
        href: "/boletins",
        label: "Boletins",
        description: "Produção e histórico técnico",
        icon: Newspaper
      }
    ]
  },
  {
    label: "Dados",
    items: [
      {
        href: "/sincronizacao",
        label: "Importar e Sincronizar",
        description: "CEVESP, TRACONET e NOTTRACONET",
        icon: Database
      },
      {
        href: "/correcoes",
        label: "Fila de Correções",
        description: "Revisar e aplicar ajustes",
        icon: CheckSquare
      },
      {
        href: "/auditoria",
        label: "Auditoria",
        description: "Histórico de ações do sistema",
        icon: ClipboardList
      }
    ]
  },
  {
    label: "Inteligência",
    items: [
      {
        href: "/chat",
        label: "Chat Epidemiológico",
        description: "Perguntas e relatórios com IA",
        icon: Bot
      },
      {
        href: "/agentes",
        label: "Agentes",
        description: "Ferramentas especializadas",
        icon: GraduationCap
      },
      {
        href: "/base-conhecimento",
        label: "Base de Conhecimento",
        description: "Documentos para RAG",
        icon: Brain
      }
    ]
  },
  {
    label: "Documentos",
    items: [
      {
        href: "/documentos",
        label: "Biblioteca",
        description: "Arquivos e documentos oficiais",
        icon: Library
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
        href: "/configuracoes",
        label: "Configurações de IA",
        description: "Provedor, modelo e chaves",
        icon: Settings
      }
    ]
  }
];

