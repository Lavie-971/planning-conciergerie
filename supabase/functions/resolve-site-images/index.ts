import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Méthode non autorisée." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Configuration serveur incomplète.");
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();
    const slug = String(body?.site_slug || "").trim();
    const preview = body?.preview === true;
    if (!slug || slug.length > 120) return reply({ error: "Site invalide." }, 400);

    let ownerId: string | null = null;
    if (preview) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return reply({ error: "Connexion requise." }, 401);
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return reply({ error: "Session invalide." }, 401);
      ownerId = authData.user.id;
      // Make the legacy image bucket private without deleting its archived files.
      const { error: legacyBucketError } = await admin.storage.updateBucket("site-images", { public: false });
      if (legacyBucketError) throw legacyBucketError;
    }

    let siteQuery = admin.from("public_owner_sites").select("user_id,site_slug,site_enabled,hero_photo_url,site_texts").eq("site_slug", slug).limit(1);
    if (preview) siteQuery = siteQuery.eq("user_id", ownerId!);
    else siteQuery = siteQuery.eq("site_enabled", true);
    const { data: sites, error: siteError } = await siteQuery;
    if (siteError) throw siteError;
    const site = sites?.[0];
    if (!site) return reply({ error: "Site indisponible." }, 404);
    ownerId = site.user_id;

    let listingQuery = admin.from("public_listings").select("id,photo_urls").eq("user_id", ownerId).eq("site_slug", slug);
    if (!preview) listingQuery = listingQuery.eq("is_published", true);
    const { data: listings, error: listingError } = await listingQuery;
    if (listingError) throw listingError;

    const migratedPaths = new Set<string>();
    const legacyPrefix = url + "/storage/v1/object/public/site-images/";
    const migrateRef = async (value: unknown): Promise<string> => {
      if (typeof value !== "string") return "";
      if (value.startsWith("private:")) return value;
      if (!value.startsWith(legacyPrefix)) return value;
      const encoded = value.slice(legacyPrefix.length).split(/[?#]/)[0];
      const path = encoded.split("/").map((part) => decodeURIComponent(part)).join("/");
      if (!path.startsWith(ownerId + "/") || path.includes("..")) return value;
      const { data: file, error: downloadError } = await admin.storage.from("site-images").download(path);
      if (downloadError || !file) { console.warn("Ancienne photo non migrée", path, downloadError?.message); return value; }
      const { error: uploadError } = await admin.storage.from("site-images-private").upload(path, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });
      if (uploadError) { console.warn("Copie privée impossible", path, uploadError.message); return value; }
      migratedPaths.add(path);
      return "private:" + path;
    };

    if (preview) {
      const newTexts = { ...(site.site_texts || {}) };
      let siteChanged = false;
      const newHero = await migrateRef(site.hero_photo_url);
      if (newHero !== (site.hero_photo_url || "")) {
        const { error } = await admin.from("public_owner_sites").update({ hero_photo_url: newHero }).eq("user_id", ownerId).eq("site_slug", slug);
        if (error) throw error;
        site.hero_photo_url = newHero;
      }
      const newPresentation = await migrateRef(newTexts.presentation_photo_url);
      if (newPresentation !== (newTexts.presentation_photo_url || "")) {
        newTexts.presentation_photo_url = newPresentation;
        siteChanged = true;
      }
      const customBlocks = Array.isArray(newTexts.custom_blocks) ? newTexts.custom_blocks : [];
      const migratedBlocks = [];
      for (const block of customBlocks) {
        const imageUrl = await migrateRef(block?.image_url);
        migratedBlocks.push({ ...block, image_url: imageUrl });
        if (imageUrl !== (block?.image_url || "")) siteChanged = true;
      }
      if (siteChanged) newTexts.custom_blocks = migratedBlocks;
      if (siteChanged) {
        const { error } = await admin.from("public_owner_sites").update({ site_texts: newTexts }).eq("user_id", ownerId).eq("site_slug", slug);
        if (error) throw error;
        site.site_texts = newTexts;
      }
      for (const listing of listings || []) {
        const original = Array.isArray(listing.photo_urls) ? listing.photo_urls : [];
        const normalized = original.flatMap((item: unknown) => typeof item === "string" ? item.split(/\\n|\n/).map((part) => part.trim()).filter(Boolean) : []);
        const migrated = [];
        for (const photo of normalized) migrated.push(await migrateRef(photo));
        if (JSON.stringify(migrated) !== JSON.stringify(original)) {
          const { error } = await admin.from("public_listings").update({ photo_urls: migrated }).eq("id", listing.id).eq("user_id", ownerId);
          if (error) throw error;
          listing.photo_urls = migrated;
        }
      }

      // Also privatize abandoned uploads in this owner's folder. They remain stored privately,
      // but are no longer reachable through the public bucket.
      const { data: oldFiles, error: listError } = await admin.storage.from("site-images").list(ownerId, { limit: 1000 });
      if (listError) throw listError;
      for (const item of oldFiles || []) {
        if (!item.id || !item.name) continue;
        const path = ownerId + "/" + item.name;
        if (migratedPaths.has(path)) continue;
        const { data: file, error: downloadError } = await admin.storage.from("site-images").download(path);
        if (downloadError || !file) { console.warn("Ancien fichier conservé publiquement, téléchargement impossible", path); continue; }
        const { error: uploadError } = await admin.storage.from("site-images-private").upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
        if (uploadError) { console.warn("Ancien fichier conservé publiquement, copie privée impossible", path); continue; }
        migratedPaths.add(path);
      }

      if (migratedPaths.size) {
        const [{ data: allSites, error: allSitesError }, { data: allListings, error: allListingsError }] = await Promise.all([
          admin.from("public_owner_sites").select("hero_photo_url,site_texts"),
          admin.from("public_listings").select("photo_urls"),
        ]);
        if (allSitesError) throw allSitesError;
        if (allListingsError) throw allListingsError;
        for (const path of migratedPaths) {
          const oldUrl = legacyPrefix + path.split("/").map(encodeURIComponent).join("/");
          const stillReferenced = (allSites || []).some((row) => row.hero_photo_url === oldUrl || row.site_texts?.presentation_photo_url === oldUrl)
            || (allSites || []).some((row) => (Array.isArray(row.site_texts?.custom_blocks) ? row.site_texts.custom_blocks : []).some((block: any) => block?.image_url === oldUrl))
            || (allListings || []).some((row) => (row.photo_urls || []).some((photo: string) => typeof photo === "string" && photo.includes(oldUrl)));
          if (!stillReferenced) {
            const { error } = await admin.storage.from("site-images").remove([path]);
            if (error) console.warn("Ancienne copie publique conservée faute de suppression", path, error.message);
          }
        }
      }
    }

    const refs: string[] = [];
    const add = (value: unknown) => {
      if (typeof value === "string" && value.startsWith("private:")) {
        const path = value.slice(8);
        if (path.startsWith(ownerId + "/") && !path.includes("..")) refs.push(path);
      }
    };
    add(site.hero_photo_url);
    add(site.site_texts?.presentation_photo_url);
    for (const block of Array.isArray(site.site_texts?.custom_blocks) ? site.site_texts.custom_blocks : []) add(block?.image_url);
    for (const listing of listings || []) for (const photo of listing.photo_urls || []) add(photo);

    // Une seule requête groupée pour toutes les photos (avant : une requête par photo,
    // l'une après l'autre, d'où un temps de réponse proportionnel au nombre d'images).
    const unique = [...new Set(refs)];
    const images: Record<string, string> = {};
    if (unique.length) {
      const { data: signed, error: signError } = await admin.storage.from("site-images-private").createSignedUrls(unique, 3600);
      if (signError) console.warn("Signature groupée impossible", signError.message);
      for (const item of signed || []) {
        if (!item.error && item.signedUrl && item.path) images["private:" + item.path] = item.signedUrl;
      }
    }
    return reply({ images, expires_in: 3600, migrated_count: migratedPaths.size });
  } catch (error) {
    console.error("resolve-site-images:", error);
    return reply({ error: "Impossible de préparer les photos sécurisées." }, 500);
  }
});
