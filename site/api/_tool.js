// Paperwork Sorter: the "scan, organize, enter and chase the paperwork" step from
// 42 Twin Cities job postings (hiring-signals, 2026-10-17). DATA_MODEL.md is the spec.
// Claude reads each document; dates are compared to today by code; money is only ever
// copied as printed.
const product = "paperwork-sorter";
const FREE = 3, PAID = 25;

const system = `You are the office person who opens the pile of paperwork. For every document you are given:
- say what it is (doc_type: invoice, W-9, certificate of insurance, lease, work order, receipt, packing slip, notice, contract, statement, other),
- who it is from or about (party, and party_role: vendor, subcontractor, tenant, customer, insurer, government, other),
- the date it carries (doc_date, YYYY-MM-DD, "" if none), its reference number as printed, and any money figure EXACTLY as printed (amount_printed, "" if none). Never add, total or derive money.
- the 3 to 8 fields someone would type into the business's system for that type (key_fields). For a W-9 give the TIN type and only the LAST 4 digits of any SSN/EIN, never the full number.
- expires_on (YYYY-MM-DD) for anything with an end date (insurance, licence, lease), else "".
- a filing_name "YYYY-MM-DD Party DocType Ref" (short, no slashes) and a folder "Party/DocType".
- problems: what is wrong or missing ON the document (unsigned, blank required field, no PO number on an invoice, illegible, amount does not match a referenced document). Do not judge expiry; code does that.
Then group by party. For each party apply the CHECKLIST the business gave (or, if none, the default: every subcontractor or vendor needs a W-9 and a certificate of insurance). List what the checklist requires that is not in the pile (missing), and write a short, plain follow_up note to that party asking for exactly what is missing or has a problem. No pleasantries beyond one line. Sign it "Thanks," with no name.
Only use what the documents say. If a field is not on the document, leave it "".`;

const str = { type: "string" };
const schema = {
  type: "object", additionalProperties: false, required: ["documents", "parties"],
  properties: {
    documents: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["n", "doc_type", "party", "party_role", "doc_date", "reference", "amount_printed", "key_fields", "expires_on", "filing_name", "folder", "problems"],
      properties: { n: { type: "integer" }, doc_type: str, party: str, party_role: str, doc_date: str, reference: str, amount_printed: str,
        key_fields: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: str, value: str } } },
        expires_on: str, filing_name: str, folder: str, problems: { type: "array", items: str } } } },
    parties: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "role", "missing", "follow_up"],
      properties: { name: str, role: str, missing: { type: "array", items: str }, follow_up: str } } },
  },
};

// "Today" is the buyer's day, not the server's: Vercel runs in UTC, so an expiry read at
// 8pm in Minneapolis would otherwise count as yesterday's and print "Expired 1 day ago".
const TZ = "America/Chicago";
const today = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function prepare(input, unlocked, files, now = new Date()) {
  const m = input.match(/^\s*CHECKLIST:([\s\S]*?)(?:\n-{3,}|$)/i);
  const checklist = m ? m[1].trim() : "";
  const body = m ? input.slice(m[0].length) : input;
  const texts = body.split(/\n-{3,}\s*\n/).map((s) => s.trim()).filter((s) => s.length > 15);
  const items = [...texts.map((t) => ({ kind: "text", t })), ...files.filter((f) => f && f.data).map((f) => ({ kind: "file", f }))];
  if (!items.length) return { error: "Paste a document (or add a file) for it to sort." };
  const cap = unlocked ? PAID : FREE;
  const use = items.slice(0, cap);
  const content = [{ type: "text", text: `Today is ${today(now)}.\nCHECKLIST: ${checklist || "(none given: use the default)"}\nThere are ${use.length} documents.` }];
  use.forEach((it, i) => {
    if (it.kind === "text") content.push({ type: "text", text: `=== Document ${i + 1} (pasted)\n${it.t}` });
    else {
      content.push({ type: "text", text: `=== Document ${i + 1} (file: ${String(it.f.name || "").slice(0, 80)})` });
      const t = String(it.f.type || "");
      if (t === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: it.f.data } });
      else if (/^image\/(png|jpeg|gif|webp)$/.test(t)) content.push({ type: "image", source: { type: "base64", media_type: t, data: it.f.data } });
      else content.push({ type: "text", text: Buffer.from(it.f.data, "base64").toString("utf8").slice(0, 20000) });
    }
  });
  return { content, shown: use.length, total: Math.min(items.length, PAID), names: use.map((it, i) => it.kind === "file" ? it.f.name : `Document ${i + 1}`) };
}

const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
function post(out, unlocked, prep, now = new Date()) {
  const t = Date.parse(today(now));
  for (const d of out.documents) {
    d.source = prep.names[d.n - 1] || `Document ${d.n}`;
    const e = Date.parse(d.expires_on);
    if (d.expires_on && !isNaN(e)) {
      const n = Math.round((e - t) / 864e5);
      if (n < 0) d.problems.unshift(`Expired ${days(-n)} ago (${d.expires_on})`);
      else if (n === 0) d.problems.unshift(`Expires today (${d.expires_on})`);
      else if (n <= 30) d.problems.unshift(`Expires in ${days(n)} (${d.expires_on})`);
    }
  }
  if (!unlocked) {
    const chase = out.parties.filter((p) => p.missing.length).length;
    return { documents: out.documents, parties_locked: chase };
  }
  return out;
}

module.exports = {
  product, site: "https://paperwork-sorter.vercel.app", name: "Paperwork Sorter", price_usd: 5,
  checkout_line: "Sort up to 25 documents a run, every run: the spreadsheet, the missing-paperwork list and the follow-up notes.",
  max_chars: 120000, effort: "low", system, schema, prepare, post, today,
};
