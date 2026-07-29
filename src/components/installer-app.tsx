"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, SquarePlus, X } from "lucide-react";

type EvenementInstallation = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Environnement = { ios: boolean; installee: boolean; refusee: boolean };

// Lu une seule fois et mémorisé : `useSyncExternalStore` exige un instantané
// stable d'un appel à l'autre, sans quoi React reboucle indéfiniment. Ces
// valeurs ne changent pas au cours d'une visite.
let instantane: Environnement | null = null;

function lireEnvironnement(): Environnement {
  if (!instantane) {
    const ua = window.navigator.userAgent;
    instantane = {
      ios: /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua),
      installee:
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true,
      refusee: sessionStorage.getItem("bolt-install-masque") === "1",
    };
  }
  return instantane;
}

const sansAbonnement = () => () => {};

/**
 * Proposition d'installation sur l'écran d'accueil.
 *
 * L'animateur reçoit son lien une fois, par courriel ou par SMS : trois
 * semaines plus tard il le cherche dans ses messages, ou renonce. Installé, le
 * raccourci porte son jeton et rouvre directement sa feuille.
 *
 * Deux chemins, parce que les navigateurs diffèrent : Android émet un événement
 * d'installation qu'on déclenche au bon moment, iOS n'a rien d'équivalent et
 * impose de passer par le menu Partager — on affiche donc la marche à suivre.
 */
export function InstallerApp() {
  const env = useSyncExternalStore(sansAbonnement, lireEnvironnement, () => null);
  const [invite, setInvite] = useState<EvenementInstallation | null>(null);
  const [ferme, setFerme] = useState(false);

  useEffect(() => {
    navigator.serviceWorker?.register("/emargement/sw.js").catch(() => {
      // Sans service worker, l'installation reste possible sur iOS et sur
      // plusieurs navigateurs : on n'en fait pas une erreur visible.
    });

    const surInvite = (e: Event) => {
      e.preventDefault(); // c'est nous qui choisissons le moment
      setInvite(e as EvenementInstallation);
    };
    window.addEventListener("beforeinstallprompt", surInvite);
    return () => window.removeEventListener("beforeinstallprompt", surInvite);
  }, []);

  if (!env || env.installee || env.refusee || ferme) return null;
  if (!invite && !env.ios) return null;

  const fermer = () => {
    sessionStorage.setItem("bolt-install-masque", "1");
    setFerme(true);
  };

  return (
    <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-indigo-900">
            Gardez vos feuilles à portée de main
          </p>
          {invite ? (
            <p className="mt-1 text-sm text-indigo-800">
              Installez l&apos;application : votre lien personnel sera accessible
              en une touche, sans le rechercher dans vos messages.
            </p>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-indigo-800">
              Touchez <Share className="h-4 w-4 shrink-0" /> puis
              <span className="inline-flex items-center gap-1 font-medium">
                <SquarePlus className="h-4 w-4 shrink-0" /> Sur l&apos;écran
                d&apos;accueil
              </span>
              : votre lien restera accessible en une touche.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={fermer}
          aria-label="Masquer"
          className="shrink-0 rounded-lg p-1 text-indigo-400 transition active:bg-indigo-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {invite && (
        <button
          type="button"
          onClick={async () => {
            await invite.prompt();
            const { outcome } = await invite.userChoice;
            setInvite(null);
            if (outcome === "accepted") setFerme(true);
          }}
          className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99]"
        >
          Installer sur l&apos;écran d&apos;accueil
        </button>
      )}
    </div>
  );
}
