"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-slate-500">
          Réessayez ; si le problème persiste, contactez la DSI en indiquant le
          code ci-dessous.
        </p>
        {/* Le digest est la clé de la ligne écrite dans les journaux du
            conteneur (src/instrumentation.ts) : c'est ce qui permet à la DSI
            de retrouver l'incident sans faire décrire l'écran. */}
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-slate-500">{error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
