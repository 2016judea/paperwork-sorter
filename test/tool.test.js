// The tool without the model: prepare() splits the pile and post() dates it.
// Plus the paywall pieces that need no network: password mint/check and the webhook's
// signature gate (dummy secrets, signed fixtures).
//   npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

process.env.ACCESS_SECRET = "test-access-secret";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
const TOOL = require("../site/api/_tool");
const lib = require("../site/api/_lib");
const webhook = require("../site/api/stripe-webhook");

const PILE = "CHECKLIST: Every sub needs a W-9.\n---\nINVOICE #1 Northside Electric total $801.70 for the job\n---\nForm W-9 Ridgeline Roofing LLC EIN ending 7651\n---\nCERTIFICATE OF LIABILITY INSURANCE Ridgeline Roofing exp 10/29/2026\n---\nPACKING SLIP Ferguson order 5521 three boxes";

test("prepare: the checklist is lifted out, documents split on --- and the free run keeps the first 3 of 4", () => {
  const p = TOOL.prepare(PILE, false, []);
  assert.equal(p.shown, 3);
  assert.equal(p.total, 4);
  assert.match(p.content[0].text, /CHECKLIST: Every sub needs a W-9\./);
  assert.match(p.content[0].text, /There are 3 documents/);
  assert.match(p.content[1].text, /Document 1 \(pasted\)\nINVOICE #1/);
  assert.equal(TOOL.prepare(PILE, true, []).shown, 4, "a password lifts the cap");
  assert.deepEqual(TOOL.prepare("   ", false, []), { error: "Paste a document (or add a file) for it to sort." });
});

test("prepare: today is told to the model in Minneapolis time, not UTC", () => {
  const lateEvening = new Date("2026-10-19T01:30:00Z"); // 8:30pm CDT on the 18th
  const p = TOOL.prepare(PILE, false, [], lateEvening);
  assert.match(p.content[0].text, /^Today is 2026-10-18\./);
});

function out(expires_on) {
  return { documents: [{ n: 1, doc_type: "certificate of insurance", party: "Ridgeline", expires_on, problems: [], key_fields: [] }], parties: [{ name: "Ridgeline", role: "subcontractor", missing: ["W-9"], follow_up: "x" }] };
}
const prep = { names: ["Document 1"] };

test("post: an expiry is judged against the buyer's calendar day", () => {
  const lateEvening = new Date("2026-10-19T01:30:00Z"); // still 2026-10-18 in Minneapolis
  assert.deepEqual(TOOL.post(out("2026-10-18"), true, prep, lateEvening).documents[0].problems, ["Expires today (2026-10-18)"]);
  assert.deepEqual(TOOL.post(out("2026-10-17"), true, prep, lateEvening).documents[0].problems, ["Expired 1 day ago (2026-10-17)"]);
  assert.deepEqual(TOOL.post(out("2026-10-19"), true, prep, lateEvening).documents[0].problems, ["Expires in 1 day (2026-10-19)"]);
  assert.deepEqual(TOOL.post(out("2026-11-17"), true, prep, lateEvening).documents[0].problems, ["Expires in 30 days (2026-11-17)"]);
  assert.deepEqual(TOOL.post(out("2026-11-18"), true, prep, lateEvening).documents[0].problems, [], "31 days out is not flagged");
  assert.deepEqual(TOOL.post(out(""), true, prep, lateEvening).documents[0].problems, []);
});

test("post: a free run keeps the parties back and counts who is missing paperwork", () => {
  const r = TOOL.post(out("2027-01-01"), false, prep, new Date("2026-10-18T12:00:00Z"));
  assert.equal(r.parties, undefined);
  assert.equal(r.parties_locked, 1);
  assert.equal(r.documents[0].source, "Document 1");
});

test("password: a minted one checks as paid, a comp one as comp, a tampered one not at all", () => {
  const { nonce, password } = lib.newPassword();
  assert.match(password, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.deepEqual(lib.checkPassword(password), { nonce, kind: "paid" });
  assert.deepEqual(lib.checkPassword(password.toLowerCase().replace(/-/g, " ")), { nonce, kind: "paid" }, "case and separators are forgiven");
  const comp = nonce + lib.mac(nonce, "comp:");
  assert.deepEqual(lib.checkPassword(comp), { nonce, kind: "comp" });
  const raw = password.replace(/-/g, "");
  const tampered = raw.slice(0, 11) + (raw[11] === "2" ? "3" : "2");
  assert.equal(lib.checkPassword(tampered), null);
  assert.equal(lib.checkPassword("short"), null);
});

const sign = (body, secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
function drive(body, header) {
  const req = new EventEmitter(); req.method = "POST"; req.headers = { "stripe-signature": header };
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  const done = webhook(req, res);
  process.nextTick(() => { req.emit("data", Buffer.from(body)); req.emit("end"); });
  return done.then(() => res);
}
const ev = (s) => JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: s } });

test("webhook: a bad or stale signature is 400; another product's paid session is ignored with 200; never a Stripe or Mailgun call", async () => {
  const body = ev({ id: "cs_test_1", payment_status: "paid", metadata: { product: "salon-rates" } });
  assert.equal((await drive(body, sign(body, "whsec_wrong"))).code, 400);
  assert.equal((await drive(body, sign(body, "whsec_test_dummy", Math.floor(Date.now() / 1000) - 700))).code, 400);
  const ok = await drive(body, sign(body, "whsec_test_dummy"));
  assert.equal(ok.code, 200);
  assert.deepEqual(ok.body, { ignored: true });
  const unpaid = ev({ id: "cs_test_2", payment_status: "unpaid", metadata: { product: "paperwork-sorter" } });
  const r = await drive(unpaid, sign(unpaid, "whsec_test_dummy"));
  assert.equal(r.code, 200);
  assert.equal(r.body.why, "not ours or not paid");
});
