export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-10">
      <div className="absolute left-6 top-5 text-lg font-semibold text-primary">DvOftalmo IA</div>
      {children}
    </main>
  );
}
