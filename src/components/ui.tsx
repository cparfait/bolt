import Link from "next/link";
import { Ticket } from "lucide-react";
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Signature de bas de page des écrans de connexion.
 *
 * Le nom de l'application doit figurer quelque part — un agent qui cherche
 * « l'appli du sport » dans son navigateur ou qui appelle la DSI a besoin de
 * pouvoir la nommer. Mais pas en titre : sous un logo, il ferait doublon avec
 * l'identité de la collectivité, et c'est le logo qui doit tenir le haut.
 *
 * D'où cette ligne discrète, détachée du formulaire : elle nomme l'outil et la
 * collectivité sans rien disputer au reste. Elle n'apparaît que lorsqu'un logo
 * est configuré — sans logo, « Bolt » est déjà le titre de la page.
 */
export function Signature({ logo, orgName }: { logo: string; orgName: string }) {
  if (!logo) return null;
  return (
    <p className="mt-10 text-center text-[11px] tracking-wide text-slate-300">
      Bolt{orgName ? ` · ${orgName}` : ""}
    </p>
  );
}

export function Badge({
  children,
  color = "bg-slate-100 text-slate-600 ring-slate-500/20",
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${color}`}
    >
      {children}
    </span>
  );
}

/** Pastille aux couleurs d'une activité (couleur libre, hors palette Tailwind). */
/**
 * Signale, sur une feuille, quelqu'un qui n'est pas inscrit au créneau : il
 * vient pour cette séance-là seulement — essai, remplacement, passage isolé.
 *
 * L'icône de ticket porte l'information à elle seule, d'un coup d'œil : une
 * entrée, pas un abonnement. Le mot « invité » employé jusqu'ici pouvait se
 * lire comme un statut sans dire l'essentiel — que cette personne ne reviendra
 * pas forcément, et qu'elle n'occupe pas de place pour la saison.
 */
export function BadgePonctuel({ className = "" }: { className?: string }) {
  return (
    <span
      title="Présent pour cette séance seulement — non inscrit au créneau pour la saison"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-600/20 ${className}`}
    >
      <Ticket className="h-3 w-3" aria-hidden />
      séance seule
    </span>
  );
}

export function PastilleActivite({ couleur, nom }: { couleur: string; nom: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset"
      style={{
        color: couleur,
        backgroundColor: `${couleur}14`,
        boxShadow: `inset 0 0 0 1px ${couleur}33`,
      }}
    >
      {nom}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  // Pour les couleurs d'activité, libres et donc hors palette Tailwind.
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

export function Field({
  label,
  required,
  hint,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500";

// suppressHydrationWarning : les gestionnaires de mots de passe injectent des
// attributs dans les champs avant l'hydratation React — sans conséquence
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      suppressHydrationWarning
      {...props}
      className={`${inputClass} ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      suppressHydrationWarning
      {...props}
      className={`${inputClass} ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea rows={3} {...props} className={`${inputClass} ${props.className ?? ""}`} />
  );
}

export const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:opacity-50";

export function Alert({ state }: { state: { error?: string; success?: string } | null }) {
  if (!state?.error && !state?.success) return null;
  return state.error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {state.error}
    </div>
  ) : (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {state.success}
    </div>
  );
}

/**
 * Tuile d'indicateur du tableau de bord. Avec `href`, elle devient cliquable :
 * un chiffre qui appelle une action doit mener à l'écran où on la mène.
 */
export function Stat({
  label,
  value,
  suffixe,
  accent = "text-brand-600 bg-brand-50",
  icon,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  suffixe?: string;
  accent?: string;
  icon?: ReactNode;
  hint?: string;
  href?: string;
}) {
  const contenu = (
    <>
      {icon && (
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}
        >
          {icon}
        </span>
      )}
      <p className="mt-3 text-2xl font-semibold tabular-nums">
        {value}
        {suffixe && <span className="ml-0.5 text-base font-medium text-slate-400">{suffixe}</span>}
      </p>
      <p className="text-sm text-slate-500">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </>
  );
  const classe = "block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  return href ? (
    <Link href={href} className={`${classe} transition hover:border-slate-300 hover:shadow`}>
      {contenu}
    </Link>
  ) : (
    <div className={classe}>{contenu}</div>
  );
}

/** Barre de progression horizontale (taux de remplissage, de présence…). */
export function Jauge({
  valeur,
  couleur = "#006e46",
  className = "",
}: {
  valeur: number; // 0–100
  couleur?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, valeur));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: couleur }}
      />
    </div>
  );
}
