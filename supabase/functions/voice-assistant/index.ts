import { GROQ_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Réglages de latence
// ---------------------------------------------------------------------------
// Avant : 4 modèles x 2 essais x 3 s de délai, enchaînés l'un après l'autre
// (jusqu'à ~25 s avant le secours), puis un secours Groq qui échouait toujours
// (prompt de ~9 000 jetons pour un quota de 8 000 -> HTTP 413).
// Maintenant : le meilleur modèle part seul ; s'il n'a pas répondu au bout de
// HEDGE_DELAY_MS, le suivant part EN PARALLÈLE (sans annuler le premier) ; la
// première réponse valide gagne. Un échec franc déclenche aussitôt le suivant.
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];
const HEDGE_DELAY_MS = 2500;
const GEMINI_ATTEMPT_TIMEOUT_MS = 9000;
const GEMINI_TOTAL_BUDGET_MS = 10000;
const GROQ_TIMEOUT_MS = 8000;
const GROQ_MAX_CONTEXT_CHARS = 9000; // ~3 000 jetons : le prompt Groq reste sous 8 000 jetons/min
const PERMANENT_STATUSES = new Set([400, 401, 403]);

type Json = Record<string, unknown>;
type Attempt = { ok: true; value: Json } | { ok: false; status: number; reason: string };

// ---------------------------------------------------------------------------
// Schéma de réponse (identique à la version précédente)
// ---------------------------------------------------------------------------
const STR = { type: "STRING" };
const INT = { type: "INTEGER", nullable: true };
const NUM = { type: "NUMBER", nullable: true };
const BOOL = { type: "BOOLEAN", nullable: true };

const RESPONSE_PROPERTIES: Record<string, unknown> = {
  action: { type: "STRING", enum: ["create", "update", "delete", "unknown"] },
  objectType: { type: "STRING", enum: ["reservation", "agenda", "apartment", "unknown"] },
  apartmentName: STR,
  name: STR,
  owner: STR,
  propertyType: STR,
  commune: STR,
  bedroomCount: INT,
  maxGuests: INT,
  propertyAddress: STR,
  ownerPhone: STR,
  ownerEmail: STR,
  ownerAddress: STR,
  cleaningDurationMinutes: INT,
  client: STR,
  phone: STR,
  target: STR,
  startDate: STR,
  endDate: STR,
  startTime: STR,
  endTime: STR,
  adults: INT,
  children: INT,
  babies: INT,
  pricePerNight: NUM,
  total: NUM,
  commissionPercent: NUM,
  commissionAmount: NUM,
  depositAmount: NUM,
  checkinTime: STR,
  checkoutTime: STR,
  flightNumber: STR,
  flightTime: STR,
  invoice: BOOL,
  tenantAddress: STR,
  title: STR,
  notes: STR,
  services: {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: { label: STR, price: NUM },
      required: ["label", "price"],
    },
  },
  status: STR,
  source: STR,
  summary: STR,
  clarification: STR,
};
// status et source ne figuraient pas dans la liste "required" d'origine.
const RESPONSE_REQUIRED = Object.keys(RESPONSE_PROPERTIES).filter((k) => k !== "status" && k !== "source");

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
/** Identifiant utilisateur lu dans le JWT. La signature est déjà vérifiée par
 *  la passerelle (verify_jwt = true) : on évite ainsi un aller-retour réseau
 *  vers /auth/v1/user avant chaque commande vocale. */
export function jwtSubject(authorization: string): string | null {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    const sub = claims?.sub;
    return typeof sub === "string" && /^[0-9a-f-]{36}$/i.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

export function keepFields(items: unknown, allowed: string[], maxItems = 60): Json[] {
  return (Array.isArray(items) ? items : []).slice(0, maxItems).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Json;
    const clean: Json = {};
    for (const key of allowed) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== "") clean[key] = value;
    }
    return Object.keys(clean).length ? [clean] : [];
  });
}

/** Détection de mots entiers compatible avec les accents (\b ne l'est pas :
 *  « arrivée » ou « payé » n'étaient jamais reconnus). Un « * » final = préfixe. */
export function matcher(text: string) {
  return (words: string[]) => {
    const alternatives = words.map((w) => w.endsWith("*") ? w.slice(0, -1) + "\\p{L}*" : w).join("|");
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "u").test(text);
  };
}

function parseJsonObject(text: string): Json | null {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gemini : course entre modèles
// ---------------------------------------------------------------------------
async function callGemini(model: string, apiKey: string, body: string, signal: AbortSignal): Promise<Attempt> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal,
      },
    );
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* ignoré */ }
      return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
    if (!text) return { ok: false, status: 0, reason: "réponse vide" };
    const parsed = parseJsonObject(text);
    if (!parsed) return { ok: false, status: 0, reason: "JSON illisible" };
    return { ok: true, value: parsed };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const aborted = name === "AbortError" || name === "TimeoutError";
    return { ok: false, status: 0, reason: aborted ? "délai dépassé" : String((error as Error)?.message || error) };
  }
}

export function raceGemini(
  models: string[],
  apiKey: string,
  body: string,
  opts = { hedgeMs: HEDGE_DELAY_MS, attemptMs: GEMINI_ATTEMPT_TIMEOUT_MS, totalMs: GEMINI_TOTAL_BUDGET_MS },
): Promise<{ value: Json; model: string } | null> {
  return new Promise((resolve) => {
    const controllers: AbortController[] = [];
    const failures: string[] = [];
    let index = 0;
    let pending = 0;
    let finished = false;
    let stopLaunching = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: { value: Json; model: string } | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(hedgeTimer);
      clearTimeout(budgetTimer);
      for (const controller of controllers) controller.abort();
      if (!value) console.error("Gemini indisponible :", failures.join(" | ") || "aucune tentative");
      resolve(value);
    };
    const budgetTimer = setTimeout(() => finish(null), opts.totalMs);

    const launch = () => {
      if (finished || stopLaunching || index >= models.length) return;
      const model = models[index++];
      pending++;
      const controller = new AbortController();
      controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), opts.attemptMs);
      const startedAt = Date.now();
      callGemini(model, apiKey, body, controller.signal)
        .then((attempt) => {
          if (finished) return;
          if (attempt.ok) {
            console.log(`Gemini ${model} : ${Date.now() - startedAt} ms`);
            finish({ value: attempt.value, model });
            return;
          }
          failures.push(`${model} ${attempt.reason} (${Date.now() - startedAt} ms)`);
          if (PERMANENT_STATUSES.has(attempt.status)) stopLaunching = true;
        })
        .finally(() => {
          clearTimeout(timer);
          pending--;
          if (finished) return;
          if (!stopLaunching && index < models.length) launch(); // échec -> modèle suivant tout de suite
          else if (pending === 0) finish(null);
        });
      clearTimeout(hedgeTimer);
      if (index < models.length) hedgeTimer = setTimeout(launch, opts.hedgeMs); // lent -> le suivant part en parallèle
    };
    launch();
  });
}

// ---------------------------------------------------------------------------
// Groq : secours indépendant de Google (prompt compact)
// ---------------------------------------------------------------------------
export function buildGroqContext(contexte: Json): string {
  const fields: Record<string, string[]> = {
    logements: ["id", "name", "apartmentName", "owner", "propertyType", "commune", "bedroomCount", "maxGuests", "cleaningDurationMinutes"],
    reservations: ["id", "apartment_id", "apartmentId", "apartmentName", "client", "checkin", "checkout", "startDate", "endDate", "adults", "children", "babies", "status", "source", "total", "pricePerNight"],
    agenda: ["id", "title", "startDate", "endDate", "startTime", "endTime", "start_at", "end_at", "apartmentName", "apartment_id"],
  };
  const compact = (items: unknown, allowed: string[]) =>
    (Array.isArray(items) ? items : []).map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const obj = value as Json;
      const result: Json = {};
      for (const key of allowed) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") result[key] = obj[key];
      }
      return Object.keys(result).length ? result : value;
    });
  const ctx: Record<string, unknown> = {
    dateDuJour: contexte.dateDuJour,
    logements: compact(contexte.logements, fields.logements),
    reservations: compact(contexte.reservations, fields.reservations),
    agenda: compact(contexte.agenda, fields.agenda),
    statuts: contexte.statuts,
    origines: contexte.origines,
  };
  // Les listes arrivent triées par pertinence (les plus proches d'aujourd'hui d'abord) :
  // on retire les éléments de fin de liste jusqu'à tenir dans le quota de jetons.
  let json = JSON.stringify(ctx);
  while (json.length > GROQ_MAX_CONTEXT_CHARS) {
    const key = (["reservations", "agenda", "logements"] as const)
      .filter((k) => (ctx[k] as unknown[]).length > 1)
      .sort((a, b) => (ctx[b] as unknown[]).length - (ctx[a] as unknown[]).length)[0];
    if (!key) break;
    const items = ctx[key] as unknown[];
    ctx[key] = items.slice(0, Math.max(1, Math.floor(items.length * 0.7)));
    json = JSON.stringify(ctx);
  }
  return json;
}

async function callGroq(groqApiKey: string, contexte: Json, phrase: string): Promise<Json | null> {
  const userContent =
    `Date du jour : ${String(contexte.dateDuJour || "non précisée")}.\n\nDonnées existantes :\n${buildGroqContext(contexte)}\n\nDemande dictée :\n${JSON.stringify(phrase)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: GROQ_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        max_completion_tokens: 1500,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erreur Groq HTTP", response.status, errorText.slice(0, 300));
      return null;
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    const parsed = typeof text === "string" ? parseJsonObject(text) : null;
    if (!parsed) {
      console.error("Groq n'a pas retourné de JSON exploitable.");
      return null;
    }
    console.log(`Groq : ${Date.now() - startedAt} ms`);
    return parsed;
  } catch (error) {
    console.error("Échec du secours Groq :", error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Fonction HTTP
// ---------------------------------------------------------------------------
export async function handler(req: Request): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405);
  }

  // verify_jwt valide le JWT ; seul un compte explicitement approuvé peut utiliser l'assistant.
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Authentification requise." }, 401);
  }
  const userId = jwtSubject(authorization);
  if (!userId) {
    return json({ error: "Session invalide. Reconnecte-toi." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    console.error("Configuration Supabase absente pour voice-assistant.");
    return json({ error: "Service momentanément indisponible." }, 503);
  }

  try {
    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?select=status&user_id=eq.${encodeURIComponent(userId)}`,
      {
        headers: { apikey: supabaseKey, Authorization: authorization },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (profileResponse.status === 401) {
      return json({ error: "Session invalide. Reconnecte-toi." }, 401);
    }
    if (!profileResponse.ok) {
      console.error("Vérification du statut du compte impossible.", profileResponse.status);
      return json({ error: "Impossible de vérifier les autorisations du compte." }, 503);
    }
    const profiles = await profileResponse.json();
    if (!Array.isArray(profiles) || profiles[0]?.status !== "approved") {
      return json({ error: "Ton compte n'est pas autorisé à utiliser l'assistant vocal." }, 403);
    }
  } catch (authError) {
    console.error("Échec de la vérification du compte voice-assistant.", authError);
    return json({ error: "Vérification du compte momentanément indisponible." }, 503);
  }

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const groqKey = Deno.env.get("GROQ_API_KEY");
    if (!geminiKey && !groqKey) {
      return json({ error: "Aucune clé d'interprétation n'est configurée." }, 500);
    }

    let body: Json;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Requête invalide." }, 400);
    }
    const phrase = String(body.phrase || "").trim();
    if (!phrase || phrase.length > 2000) {
      return json({ error: "La phrase est vide ou trop longue." }, 400);
    }

    // Réduction stricte des données envoyées aux fournisseurs IA.
    // Les téléphones, e-mails, adresses précises, coordonnées des propriétaires,
    // numéros de vol et notes libres ne quittent plus l'application.
    const contexte = {
      dateDuJour: String(body.today || "").slice(0, 10),
      logements: keepFields(body.apartments, [
        "id", "name", "apartmentName", "propertyType", "commune", "location",
        "bedroomCount", "maxGuests", "cleaningDurationMinutes",
      ]),
      reservations: keepFields(body.bookings, [
        "id", "apartmentId", "apartment_id", "apartmentName", "client",
        "checkin", "checkout", "startDate", "endDate", "adults", "children",
        "babies", "status", "source", "total", "pricePerNight",
        "commissionPercent", "commissionAmount", "depositAmount",
        "checkinTime", "checkoutTime", "invoice", "title",
      ], 100),
      // start_at / end_at / category : champs réellement envoyés par l'application
      // (ils étaient supprimés, l'IA ne voyait donc aucune date d'agenda).
      agenda: keepFields(body.agenda, [
        "id", "title", "startDate", "endDate", "startTime", "endTime",
        "start_at", "end_at", "category", "apartmentName", "apartment_id",
      ]),
      statuts: (Array.isArray(body.statuses) ? body.statuses : []).slice(0, 40),
      origines: (Array.isArray(body.sources) ? body.sources : []).slice(0, 40),
    };

    // Sélectionne les données selon le sujet demandé, sans mélanger inutilement les sections.
    const has = matcher(phrase.toLocaleLowerCase("fr"));
    const demandeGlobale = has(["ensemble", "bilan", "récapitulatif", "récap", "statistique", "statistiques", "activité", "global", "globalement"]);
    const demandeReservation = has(["réservation", "réservations", "réserve", "réserver", "client", "voyageur", "voyageurs", "arrivée", "arrivées", "départ", "départs", "séjour", "séjours", "nuitée", "nuitées", "paiement", "payé", "acompte", "commission", "facture", "annul*", "plateforme"]);
    const demandeAgenda = has(["agenda", "calendrier", "tâche", "tâches", "ménage", "nettoyage", "intervention", "rendez-vous", "événement", "événements", "maintenance", "travaux", "visite", "passage", "planning"]);
    const demandeLogement = has(["logement", "logements", "appartement", "appartements", "villa", "maison", "studio", "propriétaire", "propriétaires", "adresse", "capacité", "chambre", "chambres", "couchages", "commission"]);
    const demandePlanningMixte = has(["planning", "calendrier"]);
    const demandeCiblee = demandeReservation || demandeAgenda || demandeLogement;
    const contextePourDemande = {
      dateDuJour: contexte.dateDuJour,
      logements: demandeGlobale || demandeLogement || demandeReservation || demandeAgenda || !demandeCiblee ? contexte.logements : [],
      reservations: demandeGlobale || demandeReservation || demandePlanningMixte || !demandeCiblee ? contexte.reservations : [],
      agenda: demandeGlobale || demandeAgenda || !demandeCiblee ? contexte.agenda : [],
      statuts: demandeGlobale || demandeReservation || !demandeCiblee ? contexte.statuts : [],
      origines: demandeGlobale || demandeReservation || !demandeCiblee ? contexte.origines : [],
    };

    const userPrompt =
      `Date du jour : ${contexte.dateDuJour || "non précisée"}.\n\nDonnées existantes :\n${JSON.stringify(contextePourDemande)}\n\nDemande dictée :\n${JSON.stringify(phrase)}`;

    let interpretedResult: Json | null = null;
    let providerUsed = "";
    const startedAt = Date.now();

    if (geminiKey) {
      const geminiBody = JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: RESPONSE_PROPERTIES, required: RESPONSE_REQUIRED },
        },
      });
      const winner = await raceGemini(GEMINI_MODELS, geminiKey, geminiBody);
      if (winner) {
        interpretedResult = winner.value;
        providerUsed = `Gemini (${winner.model})`;
      }
    }

    // Secours indépendant de Google : Groq n'est appelé que si Gemini échoue.
    if (interpretedResult === null && groqKey) {
      interpretedResult = await callGroq(groqKey, contextePourDemande, phrase);
      if (interpretedResult) providerUsed = "Groq";
    }

    if (interpretedResult === null) {
      console.error("Aucun fournisseur IA n'a pu interpréter la demande.");
      return json({
        error: "Les services d'interprétation sont momentanément indisponibles. Réessaie dans quelques instants.",
        code: "AI_SERVICE_UNAVAILABLE",
      }, 503);
    }

    console.log(`Commande interprétée par ${providerUsed} en ${Date.now() - startedAt} ms`);
    return json({ result: interpretedResult });
  } catch (error) {
    console.error("Erreur voice-assistant :", error);
    return json({ error: "Impossible d'interpréter la commande vocale." }, 500);
  }
}

// Le point d'entrée n'est enregistré que dans l'environnement Deno (les tests importent ce module).
if (typeof Deno !== "undefined" && typeof Deno.serve === "function" && !Deno.env.get("VOICE_ASSISTANT_TEST")) {
  Deno.serve(handler);
}
