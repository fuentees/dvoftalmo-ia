import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Informe um e-mail valido."),
  password: z.string().min(6, "A senha deve ter ao menos 6 caracteres.")
});

export const signupSchema = loginSchema.extend({
  fullName: z.string().min(3, "Informe o nome completo."),
  role: z.enum(["admin", "coordenador", "supervisor", "usuario"]).default("usuario")
});

export const recoverPasswordSchema = z.object({
  email: z.string().email("Informe um e-mail valido.")
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type RecoverPasswordInput = z.infer<typeof recoverPasswordSchema>;
