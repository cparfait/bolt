import ExcelJS from "exceljs";
import { prisma } from "./db";
import { isoDate } from "./dates";
import {
  evolutionMensuelle,
  indicateurs,
  parActivite,
  parDirection,
  placesOffertes,
  type Filtre,
} from "./stats";
import { SEANCE_STATUT_LABELS } from "./constants";
import { getGeneralSettings } from "./settings";

/**
 * Classeur Excel du bilan de fréquentation.
 *
 * Le CSV suffit pour retraiter les données ; ce classeur sert à autre chose :
 * il est destiné à circuler tel quel en comité QVT. D'où quatre onglets
 * ordonnés du général au détail, des en-têtes figés et des largeurs fixées —
 * personne n'a envie de remettre en forme un tableau avant une réunion.
 */

const MARQUE = "FF006E46";
const ARDOISE = "FFF1F5F9";

function enTete(ws: ExcelJS.Worksheet) {
  const ligne = ws.getRow(1);
  ligne.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  ligne.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARQUE } };
  ligne.alignment = { vertical: "middle" };
  ligne.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function titreSection(ws: ExcelJS.Worksheet, texte: string) {
  const l = ws.addRow([texte]);
  l.font = { bold: true, size: 12 };
  l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARDOISE } };
  ws.addRow([]);
  return l;
}

export async function classeurStatistiques(f: Filtre): Promise<Buffer> {
  const [saison, activite, ind, activites, mensuel, directions, seances] =
    await Promise.all([
      prisma.saison.findUnique({ where: { id: f.saisonId } }),
      f.activiteId
        ? prisma.activite.findUnique({ where: { id: f.activiteId } })
        : Promise.resolve(null),
      indicateurs(f),
      parActivite(f),
      evolutionMensuelle(f),
      parDirection(f),
      prisma.seance.findMany({
        where: {
          creneau: {
            saisonId: f.saisonId,
            ...(f.activiteId ? { activiteId: f.activiteId } : {}),
          },
        },
        include: {
          creneau: { include: { activite: true, animateurs: true } },
          presences: true,
        },
        orderBy: { date: "asc" },
      }),
    ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = (await getGeneralSettings()).appName;
  wb.created = new Date();

  // ── Synthèse ─────────────────────────────────────────────────────────────
  const synthese = wb.addWorksheet("Synthèse");
  synthese.columns = [{ width: 38 }, { width: 16 }, { width: 46 }];

  const t = synthese.addRow([`Bilan de fréquentation — saison ${saison?.nom ?? ""}`]);
  t.font = { bold: true, size: 14 };
  synthese.addRow([
    activite ? `Activité : ${activite.nom}` : "Toutes activités",
  ]).font = { italic: true, color: { argb: "FF64748B" } };
  synthese.addRow([]);

  titreSection(synthese, "Indicateurs");
  const lignes: [string, string | number, string][] = [
    ["Agents inscrits", ind.inscrits, "inscriptions validées, agents distincts"],
    ["Agents ayant participé", ind.agentsUniques, "au moins une présence"],
    ["Séances planifiées", ind.seancesTotal, ""],
    ["Séances émargées", ind.seancesEmargees, ""],
    ["Séances annulées", ind.seancesAnnulees, ""],
    ["Taux de feuilles remplies", `${ind.tauxEmargement} %`, "sur les séances passées non annulées"],
    ["Présences", ind.presents, "agents effectivement venus"],
    ["Absences", ind.absents, "inscrits pointés absents"],
    ["Taux de présence", `${ind.tauxPresence} %`, "présences / pointages"],
    ["Fréquentation moyenne", ind.frequentationMoyenne, "agents par séance émargée"],
    ["Taux de remplissage", `${ind.tauxRemplissage} %`, "présences / places offertes"],
  ];
  for (const [libelle, valeur, note] of lignes) {
    const l = synthese.addRow([libelle, valeur, note]);
    l.getCell(1).font = { bold: true };
    l.getCell(3).font = { size: 9, color: { argb: "FF94A3B8" } };
  }

  synthese.addRow([]);
  titreSection(synthese, "Par activité");
  const enTeteActivites = synthese.addRow([
    "Activité",
    "Inscrits",
    "Séances émargées",
    "Présences",
    "Moyenne / séance",
    "Taux de présence",
    "Remplissage",
  ]);
  enTeteActivites.font = { bold: true };
  for (const a of activites) {
    synthese.addRow([
      a.nom,
      a.inscrits,
      a.seancesEmargees,
      a.presents,
      a.moyenne,
      `${a.tauxPresence} %`,
      `${a.tauxRemplissage} %`,
    ]);
  }

  // ── Évolution mensuelle ──────────────────────────────────────────────────
  const evolution = wb.addWorksheet("Évolution");
  evolution.columns = [
    { header: "Mois", key: "mois", width: 22 },
    { header: "Séances émargées", key: "seances", width: 18 },
    { header: "Présences", key: "presents", width: 14 },
    { header: "Moyenne par séance", key: "moyenne", width: 20 },
  ];
  enTete(evolution);
  for (const m of mensuel) {
    evolution.addRow({
      mois: m.libelle,
      seances: m.seances,
      presents: m.presents,
      moyenne: m.moyenne,
    });
  }

  // ── Directions ───────────────────────────────────────────────────────────
  const parDir = wb.addWorksheet("Directions");
  parDir.columns = [
    { header: "Direction ou service", key: "libelle", width: 44 },
    { header: "Agents distincts", key: "agents", width: 18 },
    { header: "Présences", key: "presents", width: 14 },
  ];
  enTete(parDir);
  for (const d of directions) {
    parDir.addRow({ libelle: d.libelle, agents: d.agents, presents: d.presents });
  }

  // ── Détail des séances ───────────────────────────────────────────────────
  const detail = wb.addWorksheet("Séances");
  detail.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Activité", key: "activite", width: 26 },
    { header: "Horaire", key: "horaire", width: 14 },
    { header: "Lieu", key: "lieu", width: 34 },
    { header: "Animateur(s)", key: "coach", width: 28 },
    { header: "Statut", key: "statut", width: 14 },
    { header: "Inscrits pointés", key: "pointes", width: 16 },
    { header: "Présents", key: "presents", width: 11 },
    { header: "Absents", key: "absents", width: 10 },
    { header: "Capacité", key: "capacite", width: 11 },
    { header: "Commentaire", key: "commentaire", width: 40 },
  ];
  enTete(detail);
  // Onze colonnes : A → K. La borne suivait mal le nombre réel de colonnes.
  detail.autoFilter = { from: "A1", to: "K1" };

  for (const s of seances) {
    const n = (etat: string) => s.presences.filter((p) => p.etat === etat).length;
    detail.addRow({
      date: isoDate(s.date),
      activite: s.creneau.activite.nom,
      horaire: `${s.creneau.heureDebut}–${s.creneau.heureFin}`,
      lieu: s.creneau.lieu ?? "",
      coach: s.creneau.animateurs.map((a) => `${a.prenom} ${a.nom}`).join(", "),
      statut: SEANCE_STATUT_LABELS[s.statut],
      pointes: s.presences.length,
      presents: n("PRESENT"),
      absents: n("ABSENT"),
      capacite: placesOffertes(s),
      commentaire: s.motifAnnulation ?? s.commentaire ?? "",
    });
  }

  // exceljs renvoie un ArrayBuffer côté Node : on le convertit pour la réponse.
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
