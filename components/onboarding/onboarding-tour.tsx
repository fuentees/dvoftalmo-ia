"use client";

import { useEffect, useState } from "react";
import { Bot, BarChart2, FileText, Bell, X, ChevronRight } from "lucide-react";

const STORAGE_KEY = "dvoftalmo_onboarding_done";

const STEPS = [
  {
    icon: Bot,
    title: "Chat com IA epidemiológica",
    body: "Faça perguntas sobre surtos, casos por GVE, tracoma e mais. O agente busca dados reais do CEVESP e dos seus documentos."
  },
  {
    icon: BarChart2,
    title: "Dashboard CEVESP",
    body: "Visualize KPIs semanais, comparativos anuais e municípios com maior incidência — atualizado automaticamente."
  },
  {
    icon: Bell,
    title: "Alertas automáticos",
    body: "Toda segunda-feira o sistema verifica aumentos >50% em qualquer GVE e envia alertas epidemiológicos. Acesse em Alertas."
  },
  {
    icon: FileText,
    title: "Base de conhecimento",
    body: "Faça upload de protocolos, circulares e artigos. A IA cita as fontes nas respostas e você pode gerenciar tudo em Documentos."
  }
];

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep]       = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch { /* storage blocked */ }
  }, []);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
  }

  function next() {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  }

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <button onClick={dismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full flex-1 transition-colors
              ${i <= step ? "bg-teal-600" : "bg-gray-200 dark:bg-gray-700"}`} />
          ))}
        </div>

        <div className="flex flex-col items-center text-center gap-4">
          <div className="bg-teal-50 dark:bg-teal-900/30 rounded-2xl p-4">
            <Icon className="w-10 h-10 text-teal-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{current.title}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{current.body}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-6">
          <button onClick={dismiss} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            Pular tutorial
          </button>
          <button onClick={next}
            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {step < STEPS.length - 1 ? (
              <><span>Próximo</span><ChevronRight className="w-4 h-4" /></>
            ) : (
              <span>Começar</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
