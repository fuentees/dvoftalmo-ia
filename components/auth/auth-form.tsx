"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  loginSchema,
  recoverPasswordSchema,
  signupSchema,
  type LoginInput,
  type RecoverPasswordInput,
  type SignupInput
} from "@/lib/validation/auth";

type Mode = "login" | "signup" | "recover";

type FormValues = {
  email: string;
  password?: string;
  fullName?: string;
  role?: "admin" | "coordenador" | "supervisor" | "usuario";
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const supabase = createClient();
  const [serverMessage, setServerMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const schema = mode === "signup" ? signupSchema : mode === "recover" ? recoverPasswordSchema : loginSchema;

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", fullName: "", role: "usuario" }
  });

  async function onSubmit(values: FormValues) {
    setServerMessage(null);
    setLoading(true);

    try {
      if (mode === "recover") {
        const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
          redirectTo: `${location.origin}/login`
        });
        setServerMessage({
          text: error ? error.message : "Instrucoes enviadas para o seu e-mail.",
          isError: !!error
        });
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password!,
          options: { data: { full_name: values.fullName, role: values.role } }
        });
        if (error) {
          setServerMessage({ text: error.message, isError: true });
        } else {
          setServerMessage({ text: "Conta criada! Verifique o e-mail se a confirmacao estiver ativa.", isError: false });
          router.push("/dashboard");
        }
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password!
      });
      if (error) {
        setServerMessage({ text: error.message, isError: true });
      } else {
        router.push("/dashboard");
      }
    } finally {
      setLoading(false);
    }
  }

  const titles: Record<Mode, string> = {
    login: "Entrar",
    signup: "Criar conta",
    recover: "Recuperar senha"
  };
  const title = titles[mode];

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>DvOftalmo IA — Vigilancia Epidemiologica das Conjuntivites</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {mode === "signup" && (
            <div className="space-y-1">
              <Label htmlFor="fullName">Nome completo</Label>
              <Input id="fullName" {...register("fullName")} autoComplete="name" />
              {errors.fullName && (
                <p className="text-xs text-red-600">{errors.fullName.message}</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" {...register("email")} autoComplete="email" />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          {mode !== "recover" && (
            <div className="space-y-1">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                {...register("password")}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>
          )}

          {serverMessage && (
            <p className={`rounded-md border px-3 py-2 text-sm ${serverMessage.isError ? "border-red-300 bg-red-50 text-red-700" : "border-green-300 bg-green-50 text-green-700"}`}>
              {serverMessage.text}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Aguarde..." : title}
          </Button>
        </form>

        <div className="mt-4 flex justify-between text-sm text-muted-foreground">
          {mode !== "login" && <Link href="/login" className="hover:text-foreground">Fazer login</Link>}
          {mode !== "signup" && <Link href="/cadastro" className="hover:text-foreground">Criar conta</Link>}
          {mode !== "recover" && <Link href="/recuperar-senha" className="hover:text-foreground">Esqueci a senha</Link>}
        </div>
      </CardContent>
    </Card>
  );
}
