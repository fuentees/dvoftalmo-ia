import { z } from "zod";

export const documentUploadSchema = z.object({
  title: z.string().min(3),
  category: z.enum([
    "tracoma",
    "conjuntivite",
    "treinamentos",
    "relatorios",
    "manuais",
    "oficios",
    "despachos",
    "legislacao",
    "outros"
  ]),
  tags: z.array(z.string()).default([])
});

export const templateSchema = z.object({
  title: z.string().min(3),
  category: z.enum(["oficio", "despacho", "relatorio", "email", "convite", "memorando"]),
  content: z.string().min(10),
  isPublic: z.boolean().default(false)
});

export const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
  agent: z.enum([
    "documentos", "email", "treinamentos", "campo",
    "epidemiologico", "geral",
    "tracoma", "dados", "cos"
  ]).default("geral"),
  fileIds: z.array(z.string().uuid()).default([])
});

export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type ChatInput = z.infer<typeof chatSchema>;
