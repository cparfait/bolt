"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-slate-500">
          L&apos;incident a été enregistré. Réessayez ; si le problème persiste,
          contactez la DSI.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
