export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-6 px-5 py-10">
      <div className="flex flex-col gap-1">
        <p className="font-display text-sm tracking-widest text-muted">分账本</p>
        <h1 className="font-display text-3xl font-extrabold">{title}</h1>
      </div>
      {children}
    </main>
  );
}
