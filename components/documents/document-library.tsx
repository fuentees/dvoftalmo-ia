"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, Search, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { categoryLabels } from "@/lib/types";
import { useState } from "react";

export function DocumentLibrary() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("todos");
  const documents = useQuery({
    queryKey: ["documents", search, category],
    queryFn: async () => {
      const response = await fetch(`/api/documents?search=${encodeURIComponent(search)}&category=${category}`);
      if (!response.ok) return [];
      return response.json();
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Biblioteca documental</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Pesquisar por titulo ou descricao" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="todos">Todas categorias</option>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="grid gap-3">
          {(documents.data ?? []).map((doc: any) => (
            <div key={doc.id} className="flex items-center gap-3 rounded-md border p-3">
              <FileText className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">v{doc.version} · {doc.file_name}</p>
              </div>
              <Badge>{categoryLabels[doc.category as keyof typeof categoryLabels] ?? doc.category}</Badge>
              {doc.favorite && <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />}
            </div>
          ))}
          {documents.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento encontrado.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
