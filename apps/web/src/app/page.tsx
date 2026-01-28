export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">AMCore</h1>
      <p className="mt-4 text-muted-foreground">Personal productivity platform</p>
      <div className="mt-8 flex gap-4">
        <div className="rounded-lg border border-border bg-muted p-4">
          <h2 className="font-semibold">Fitness</h2>
          <p className="text-sm text-muted-foreground">Workout tracking</p>
        </div>
        <div className="rounded-lg border border-border bg-muted p-4">
          <h2 className="font-semibold">Finance</h2>
          <p className="text-sm text-muted-foreground">Money management</p>
        </div>
        <div className="rounded-lg border border-border bg-muted p-4">
          <h2 className="font-semibold">Subscriptions</h2>
          <p className="text-sm text-muted-foreground">Track services</p>
        </div>
      </div>
    </main>
  );
}
