export default function Loading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        color: "var(--soto-text, #273342)",
        background: "var(--soto-background, #f7f8fa)",
        fontFamily: "var(--font-sans, sans-serif)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.95rem" }}>Loading your workspace…</p>
    </main>
  );
}
