"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-xl font-semibold">Something broke</h1>
      <p className="max-w-md text-sm text-muted">
        The error is logged. No number you saw before this page should be
        trusted less because of it — pages render from cached data, not live
        computation.
      </p>
      <button
        onClick={reset}
        className="mt-2 rounded border border-accent bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent"
      >
        Try again
      </button>
    </div>
  );
}
