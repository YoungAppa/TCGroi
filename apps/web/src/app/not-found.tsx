import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="tabular text-5xl font-bold text-muted">404</p>
      <h1 className="text-xl font-semibold">No such page</h1>
      <p className="max-w-md text-sm text-muted">
        The product or set you&apos;re after either doesn&apos;t exist or
        doesn&apos;t have real pull-rate data yet — placeholder sets don&apos;t
        get pages until they have citable numbers.
      </p>
      <Link
        href="/"
        className="mt-2 rounded border border-accent bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent"
      >
        Back to rankings
      </Link>
    </div>
  );
}
