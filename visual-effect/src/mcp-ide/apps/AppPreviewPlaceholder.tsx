"use client"

export function AppPreviewPlaceholder() {
  return (
    <section className="apps-preview-placeholder" aria-label="Apps preview unavailable">
      <div className="section-label">
        <span>APP PREVIEW</span>
        <span>FIXTURE ONLY</span>
      </div>
      <button type="button" data-testid="apps-preview-disabled" disabled>
        PREVIEW DISABLED
      </button>
      <strong>UNAVAILABLE UNTIL ACCEPTED WP9</strong>
      <p>No iframe, Host bridge, View runtime, or wire behavior is active in this checkpoint.</p>
    </section>
  )
}
