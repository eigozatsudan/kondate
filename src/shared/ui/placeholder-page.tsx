export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <main className="page-frame stack">
      <h1>{title}</h1>
      <section className="card">
        <p>{description}</p>
      </section>
    </main>
  );
}
