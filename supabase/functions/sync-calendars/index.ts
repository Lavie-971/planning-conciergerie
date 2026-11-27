
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const secretKeys = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"
);

const CRON_SECRET_KEY = secretKeys.default || "";
const TIME_ZONE = "America/Guadeloupe";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

// Nombre de calendriers (Airbnb / Booking) récupérés en parallèle.
const FEED_CONCURRENCY = 4;

/** Comparaison indépendante de l'ordre des clés (jsonb ne conserve pas l'ordre d'écriture). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return "{" + Object.keys(obj).sort()
      .filter(key => obj[key] !== undefined)
      .map(key => JSON.stringify(key) + ":" + stableStringify(obj[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function allowedUrl(raw: string, provider: "airbnb" | "booking"): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();

  const allowed = provider === "airbnb"
    ? host === "airbnb.com" || host.endsWith(".airbnb.com") ||
      host === "airbnb.fr" || host.endsWith(".airbnb.fr")
    : host === "booking.com" || host.endsWith(".booking.com");

  if (
    url.protocol !== "https:" ||
    !allowed ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Adresse de calendrier non autorisée.");
  }

  return url;
}

async function fetchCalendar(
  raw: string,
  provider: "airbnb" | "booking"
): Promise<string> {
  let url = allowedUrl(raw, provider);

  for (let i = 0; i < 4; i++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "PlanningConciergerie-iCal/1.0"
      },
      signal: AbortSignal.timeout(20000)
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirection invalide.");
      url = allowedUrl(new URL(location, url).toString(), provider);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Calendrier inaccessible (${response.status}).`);
    }

    const text = await response.text();

    if (text.length > 2_000_000) {
      throw new Error("Calendrier trop volumineux.");
    }

    if (!text.includes("BEGIN:VCALENDAR")) {
      throw new Error("Format iCal invalide.");
    }

    return text;
  }

  throw new Error("Trop de redirections.");
}

function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function property(lines: string[], name: string) {
  const line = lines.find(x =>
    x.toUpperCase().startsWith(name + ":") ||
    x.toUpperCase().startsWith(name + ";")
  );

  if (!line) return null;

  const colon = line.indexOf(":");

  return {
    params: line.slice(0, colon),
    value: line.slice(colon + 1).trim()
  };
}

function dateValue(prop: { params: string; value: string }): string {
  const value = prop.value;

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?$/
  );

  if (!match) throw new Error("Date iCal invalide.");

  const [, y, m, d, hh, mm, ss = "00", zone = ""] = match;

  if (zone === "Z" || /^[+-]\d{4}$/.test(zone)) {
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${
      zone === "Z" ? "Z" : zone.slice(0, 3) + ":" + zone.slice(3)
    }`;

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Date invalide.");
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    const part = (type: string) =>
      parts.find(x => x.type === type)?.value || "";

    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  return `${y}-${m}-${d}`;
}

type ImportedEvent = {
  uid: string;
  checkin: string;
  checkout: string;
};

function parseCalendar(text: string): ImportedEvent[] {
  const lines = unfold(text);
  const events: ImportedEvent[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      if (current) throw new Error("Événement iCal imbriqué.");
      current = [];
    } else if (line === "END:VEVENT") {
      if (!current) throw new Error("Événement iCal incomplet.");

      const uid = property(current, "UID");
      const start = property(current, "DTSTART");
      const end = property(current, "DTEND");
      const status = property(current, "STATUS");

      if (!uid?.value || !start || !end) {
        throw new Error("Événement sans UID ou dates.");
      }

      if (status?.value.toUpperCase() !== "CANCELLED") {
        const checkin = dateValue(start);
        const checkout = dateValue(end);

        if (checkout <= checkin) {
          throw new Error("Dates de réservation incohérentes.");
        }

        events.push({ uid: uid.value, checkin, checkout });
      }

      current = null;
    } else if (current) {
      current.push(line);
    }
  }

  if (current) throw new Error("Calendrier iCal tronqué.");

  return events;
}

async function rowsFor(
  table: string,
  userId: string,
  activeOnly = true
) {
  const result: any[] = [];

  for (let from = 0; ; from += 1000) {
    let query = admin
      .from(table)
      .select("id,data,deleted")
      .eq("user_id", userId)
      .range(from, from + 999);

    if (activeOnly) {
      query = query.eq("deleted", false);
    }

    const { data, error } = await query;

    if (error) throw error;

    result.push(...(data || []));

    if (!data || data.length < 1000) break;
  }

  return result;
}

async function syncFeed(
  userId: string,
  apartment: any,
  provider: "airbnb" | "booking",
  feedUrl: string,
  existing: any[],
  existingById: Map<string, any>
) {
  const feedKey = await hash(feedUrl);
  const calendar = await fetchCalendar(feedUrl, provider);
  const events = parseCalendar(calendar);

  // Les réservations (existing) sont chargées une seule fois par compte dans syncUser :
  // avant, la table entière était relue pour CHAQUE calendrier, puis parcourue à chaque événement.

  const managed = existing.filter(row =>
    row.data?.icalManaged === true &&
    row.data?.icalFeedKey === feedKey &&
    row.data?.icalProvider === provider &&
    String(row.data?.apartmentId) === String(apartment.id) &&
    row.deleted === false
  );

  const imported: any[] = [];

  for (const event of events) {
    const id = "ical-" + await hash(
      `${userId}|${apartment.id}|${provider}|${feedKey}|${event.uid}`
    );

    const existingRow = existingById.get(id);
    const manualStatusOverride = existingRow?.data?.manualStatusOverride === true;

    imported.push({
      id,
      apartmentId: String(apartment.id),
      client: provider === "airbnb"
        ? "Réservation Airbnb"
        : "Réservation Booking.com",
      checkin: event.checkin,
      checkout: event.checkout,
      status: manualStatusOverride
        ? existingRow.data.status
        : "indisponible",
      source: provider,
      notes: "Blocage importé automatiquement depuis le calendrier iCal.",
      icalManaged: true,
      icalProvider: provider,
      icalEventUid: event.uid,
      icalFeedKey: feedKey,
      ...(manualStatusOverride ? { manualStatusOverride: true } : {})
    });
  }

  const safeImported = imported.filter(item => {
    const existingRow = existingById.get(item.id);

    if (!existingRow) return true;

    return (
      existingRow.data?.icalManaged === true &&
      existingRow.data?.icalProvider === provider &&
      existingRow.data?.icalFeedKey === feedKey &&
      String(existingRow.data?.apartmentId) === String(apartment.id)
    );
  });

  // Seules les lignes nouvelles ou modifiées sont écrites. Avant, tous les blocages étaient
  // réécrits chaque heure : updated_at changeait partout, ce qui forçait tous les appareils
  // à se resynchroniser pour rien.
  const changed = safeImported.filter(item => {
    const row = existingById.get(item.id);
    return !row || row.deleted !== false || stableStringify(row.data) !== stableStringify(item);
  });

  if (changed.length) {
    const rows = changed.map(data => ({
      user_id: userId,
      id: data.id,
      data,
      deleted: false,
      updated_at: new Date().toISOString()
    }));

    const { error } = await admin
      .from("bookings")
      .upsert(rows, { onConflict: "user_id,id" });

    if (error) throw error;
  }

  const keep = new Set(safeImported.map(x => x.id));

  const obsolete = managed
    .filter(row => !keep.has(String(row.id)))
    .map(row => String(row.id));

  if (obsolete.length) {
    const { error } = await admin
      .from("bookings")
      .update({
        deleted: true,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .in("id", obsolete);

    if (error) throw error;
  }

  return safeImported.length;
}

async function syncUser(userId: string) {
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) throw profileError;

  if (profile?.status !== "approved") {
    return { ignored: true };
  }

  const apartments = await rowsFor("apartments", userId);
  let imported = 0;
  const errors: string[] = [];

  const tasks: { apt: any; provider: "airbnb" | "booking"; url: string }[] = [];

  for (const row of apartments) {
    const apt = row.data;
    if (!apt || !apt.id) continue;

    for (const [provider, field] of [
      ["airbnb", "icalAirbnbUrl"],
      ["booking", "icalBookingUrl"]
    ] as const) {
      const url = apt[field];
      if (!url) continue;
      tasks.push({ apt, provider, url: String(url) });
    }
  }

  if (!tasks.length) return { imported, errors };

  const failureMessage = (task: { apt: any; provider: string }) =>
    `${task.apt.name || task.apt.id} (${task.provider}): calendrier non actualisé.`;

  let existing: any[];
  try {
    existing = await rowsFor("bookings", userId, false);
  } catch (error) {
    console.error("Lecture des réservations impossible", userId, error);
    return { imported, errors: tasks.map(failureMessage) };
  }
  const existingById = new Map<string, any>(existing.map(row => [String(row.id), row]));

  // Les calendriers sont récupérés en parallèle (4 à la fois) ; leurs lignes sont disjointes
  // (identifiants dérivés du logement, du fournisseur et du flux), sans risque de collision.
  const outcomes = await mapLimit(tasks, FEED_CONCURRENCY, async (task) => {
    try {
      return { count: await syncFeed(userId, task.apt, task.provider, task.url, existing, existingById), failed: false };
    } catch (error) {
      console.error("Échec iCal", userId, task.apt.id, task.provider, error);
      return { count: 0, failed: true };
    }
  });

  outcomes.forEach((outcome, index) => {
    if (outcome.failed) errors.push(failureMessage(tasks[index]));
    else imported += outcome.count;
  });

  return { imported, errors };
}


Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const apiKey = req.headers.get("apikey") || "";
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");

    const isCron = !!CRON_SECRET_KEY && apiKey === CRON_SECRET_KEY;

    let userIds: string[] = [];

    if (isCron) {
      const { data, error } = await admin
        .from("user_profiles")
        .select("user_id")
        .eq("status", "approved");

      if (error) throw error;

      userIds = (data || []).map(x => x.user_id);
    } else {
      if (!token) {
        return json({ error: "Authentification requise." }, 401);
      }

      const { data, error } = await admin.auth.getUser(token);

      if (error || !data.user) {
        return json({ error: "Session invalide." }, 401);
      }

      userIds = [data.user.id];
    }

    const results = [];

    for (const userId of userIds) {
      try {
        results.push({
          userId,
          result: await syncUser(userId)
        });
      } catch (error) {
        console.error(
          "Erreur de synchronisation du compte",
          userId,
          error
        );

        results.push({
          userId,
          error: "Synchronisation impossible."
        });
      }
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error("Erreur générale iCal", error);
    return json({ error: "Erreur interne de synchronisation." }, 500);
  }
});
