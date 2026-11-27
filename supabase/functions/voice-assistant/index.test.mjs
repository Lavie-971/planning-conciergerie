import assert from "node:assert/strict";
import { jwtSubject, matcher, buildGroqContext, keepFields } from "./index.ts";
import { GROQ_SYSTEM_PROMPT } from "./prompts.ts";

const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const uid = "11111111-2222-3333-4444-555555555555";
const token = encode({ alg: "ES256" }) + "." + encode({ sub: uid, role: "authenticated" }) + ".sig";

assert.equal(jwtSubject("Bearer " + token), uid);
assert.equal(jwtSubject("Bearer invalid"), null);

assert.ok(matcher("le client est arrivée hier et a payé")(["arrivée"]));
assert.ok(matcher("annule la résa de martin")(["annul*"]));
assert.ok(!matcher("ménagement")(["ménage"]));

assert.deepEqual(
  keepFields([{ id: 1, title: "Ménage", start_at: "2026-12-01T09:00", phone: "secret" }], ["id", "title", "start_at"]),
  [{ id: 1, title: "Ménage", start_at: "2026-12-01T09:00" }]
);

const reservations = Array.from({ length: 100 }, (_, i) => ({
  id: "b" + i, client: "Client " + i, checkin: "2026-12-01",
  checkout: "2026-12-05", status: "confirmee", total: 900
}));
const context = JSON.parse(buildGroqContext({
  dateDuJour: "2026-11-26",
  logements: [{ id: "a1", name: "Villa" }],
  reservations, agenda: [], statuts: [], origines: []
}));
assert.ok(JSON.stringify(context).length <= 9000);
assert.ok(context.reservations.length > 0);
assert.ok(GROQ_SYSTEM_PROMPT.length < 5000);

console.log("Tests assistant vocal : 4 groupes de vérifications réussis.");
