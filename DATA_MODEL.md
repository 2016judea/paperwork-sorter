# Data model (written first, 2026-10-17)

The need, in the words of Twin Cities job postings (Sept–Oct 2026): *"Scan and organize
incoming mail and property records"*, *"Obtain and maintain Form W-9s from subcontractors
and vendors"*, *"Follow up aggressively on missing or expired documentation"*, *"Enter
leases, notices and other documentation into property management software"*. 42 distinct
employers posted a version of this step. The ideal tool takes the pile and hands back a
filed, entered, chased pile.

## Entities

**Document** — one thing that arrived (a PDF, a photo, a pasted email).

| field | answers |
|---|---|
| source_name | which file was this? |
| doc_type | what is it? (invoice, W-9, certificate of insurance, lease, work order, receipt, packing slip, notice, contract, other) |
| party | who is it from or about? (joins to Party) |
| doc_date | what date does it carry? |
| reference | invoice / policy / PO / unit number as printed |
| amount_printed | the money figure exactly as printed, never computed |
| key_fields | the 3–8 fields someone would type into the system for this type (e.g. W-9: legal name, TIN type, TIN last 4, entity type, signed y/n) |
| expires_on | for COIs, licences, leases: the end date printed |
| filing_name | `YYYY-MM-DD Party DocType Ref` — what to name the file |
| folder | where it goes (Party / DocType) |
| problems | what is wrong or missing on this document (unsigned W-9, COI expired or expiring within 30 days, invoice without PO, illegible) |

**Party** — a vendor, subcontractor, tenant or customer.

| field | answers |
|---|---|
| name | who |
| documents | which documents we hold for them (Document.party) |
| missing | which documents the checklist requires that are not in the pile |
| follow_up | a short note to send them asking for what is missing or expired |

**Checklist** — brought by the customer (one line each, editable on the page):
`Every subcontractor: W-9, certificate of insurance`. Joins to Party by party role.

## Reality check, field by field

| field | source | fillable? |
|---|---|---|
| everything on Document | the document itself, read by Claude | yes: printed text or image |
| expires_on vs today | code compares the printed date to the run date | yes |
| Party.missing | Checklist (customer) minus Documents (pile) | yes, when a checklist is given; the default checklist is shown and editable |
| follow_up | drafted from Party.missing | yes |
| amount_printed | printed figure only; the tool never adds or derives money | yes |

Nothing in the model needs data we don't have: the customer brings every input. Not
covered: pushing rows into their actual system (QuickBooks, AppFolio, a DMS). The CSV
is the hand-off; a direct connector is the custom-build line on the page.
