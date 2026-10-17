function renderOutput(out, el, unlocked) {
  const docs = out.documents || [];
  const h = [];
  h.push(`<ol class="docs">`);
  for (const d of docs) {
    const kf = (d.key_fields || []).filter(k => k.value).map(k => `<tr><th>${esc(k.name.replace(/_/g, " "))}</th><td>${esc(k.value)}</td></tr>`).join("");
    h.push(`<li><div class="fn">${esc(d.filing_name)}</div>
      <div class="meta"><span class="chip">${esc(d.doc_type)}</span> ${esc(d.party || "party not shown")} <span class="hint">→ ${esc(d.folder)}</span></div>
      ${(d.problems || []).length ? `<ul class="probs">${d.problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : `<div class="ok">Nothing missing on this one</div>`}
      <details><summary>What goes into the system (${(d.key_fields || []).filter(k => k.value).length} fields)</summary><table class="kf">${kf}</table></details></li>`);
  }
  h.push(`</ol>`);
  if (out.parties) {
    const chase = out.parties.filter(p => p.missing.length);
    h.push(`<h4 class="sub">Who to chase (${chase.length})</h4>`);
    for (const p of chase) {
      h.push(`<div class="party"><b>${esc(p.name)}</b> <span class="hint">${esc(p.role)}</span>
        <ul class="probs">${p.missing.map(m => `<li>${esc(m)}</li>`).join("")}</ul>
        <pre class="draft">${esc(p.follow_up)}</pre><button class="ghost copy" data-t="${esc(p.follow_up)}">Copy note</button></div>`);
    }
    h.push(`<div class="row"><button class="ghost" id="csv">Download the spreadsheet</button></div>`);
  } else if (out.parties_locked !== undefined) {
    h.push(`<div class="lock">${out.parties_locked ? `${out.parties_locked} ${out.parties_locked === 1 ? "party is" : "parties are"} missing paperwork.` : ""} With $5: who is missing what, the follow-up note to each, and the spreadsheet. <a href="#pay" onclick="track('paywall_click',{why:'chase'})">Unlock</a></div>`);
  }
  el.innerHTML = h.join("");
  el.querySelectorAll(".copy").forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.t); b.textContent = "Copied"; track("copy_note"); });
  const c = el.querySelector("#csv");
  if (c) c.onclick = () => {
    const names = [...new Set(docs.flatMap(d => (d.key_fields || []).map(k => k.name)))];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["filing_name", "doc_type", "party", "doc_date", "reference", "amount_printed", "expires_on", "folder", "problems", ...names].map(q).join(",")];
    for (const d of docs) { const kv = Object.fromEntries((d.key_fields || []).map(k => [k.name, k.value]));
      rows.push([d.filing_name, d.doc_type, d.party, d.doc_date, d.reference, d.amount_printed, d.expires_on, d.folder, (d.problems || []).join("; "), ...names.map(n => kv[n])].map(q).join(",")); }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" })); a.download = "paperwork.csv"; a.click(); track("download");
  };
}
