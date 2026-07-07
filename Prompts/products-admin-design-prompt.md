# Claude Design brief — Products admin: Add & Import (direct-sales dashboard)

## What this is
An addition to the existing **direct-sales accountant/admin dashboard**, in its established **"instrument" design language** — a ledger, not a consumer app. Match the existing Orders (S8) and workbench (S9) screens:
- Hairline rules (no drop shadows), **2px corner radius** everywhere, no gradients.
- **Space Grotesk** for structure/labels/names; **JetBrains Mono** for *every figure* (prices, counts, row numbers) — tabular, right-aligned.
- Palette: accent `#1D4ED8` (primary action / focus / "new"), ink `#14181F` (text, rules), paper `#F2F3F5` (ground), white cards, hairline `#D8DBDF`, **amber `#B45309` = pending only**, green `#15803D` = success, red `#B91C1C` = error/reserved.
- Status = a **flat rectangular tag with a leading 8px square**, never a pastel pill.
- **One filled-accent action per screen, maximum.**

Design **desktop-first (≥1280px)** and a **phone** layout (full-screen sheet). The team will mostly use PC, but it must work one-handed on a phone too.

## Where it lives
The dashboard's **Products** page (left nav: Orders · Retailers · Products), **admin-only**. Today Products is a dense ledger of SKUs with inline price / active / tally-name edit. Add two entry points at the top of that page: a secondary **"+ Add product"** button and a secondary **"Import"** button.

---

## Screen A — Manual add (a compact modal/overlay)
A small centered modal on PC; a bottom sheet on phone. Fields in the instrument style (white field, 1px hairline, 2px radius, 1px accent focus):
- **Brand** — select (Zebronics / LG)
- **Category** — select of the brand's existing categories, with an inline **"＋ new category"** option
- **Display name** — text
- **Tally name** — text, optional · helper: *"Leave blank to use the display name."*
- **Price** — ₹ whole rupees, mono, optional · helper: *"Blank = not priced yet (hidden from salesmen)."* For a manual-priced brand (LG) replace the field with a quiet note: *"LG prices are entered per order."*
- **Active** — toggle, default on
Actions: filled-accent **Add product** (the one accent action) + hairline **Cancel**. Red-edged error strip for validation ("Enter a display name").

## Screen B — Import (a LARGE overlay / full-screen sheet — it carries a table)
A 3-step flow inside one panel (don't cramp it into a small popup):

**Step 1 · Upload.**
- **Brand** select (one brand per file).
- A drop-zone / **"Choose Excel file (.xlsx)"** control.
- Under it: the expected columns in mono — `Category · Display Name · Tally Name · Price · Active` — and a **"Download template"** link.

**Step 2 · Preview (the important screen).**
- A **summary bar** of three flat status tags with counts: **■ New** (accent square) · **■ Updated** (ink/grey square) · **■ Errors** (red square). *Avoid amber here — amber means "pending" elsewhere in the app.*
- A dense **preview table**, hairline rules: columns `#` · `Category` · `Display Name` · `Tally Name` · `Price` (₹ mono, right-aligned) · `Status`. Status per row = a flat square tag: **New** / **Updated** / **Error**. Error rows are red-edged with the reason inline (e.g. *"missing display name"*, *"price not a whole number"*).
- A quiet note line: *"N products already in the catalog aren't in this file — they'll be left untouched (deactivate discontinued ones manually)."*
- The one filled-accent action: **Apply import**. Design two variants: (a) errors present → an "Apply the N valid rows" affordance with the error count shown; (b) all clean → straight "Apply import." Secondary: **Choose another file** / Cancel.

**Step 3 · Result.**
- A confirmation summary in mono: *"Added 12 · Updated 30 · Skipped 2."* Optionally the final state per row.
- **Done** returns to the (now-updated) Products list.
- Also draw the **applying** state between Step 2 and 3 (spinner on the accent button, panel disabled), and a **"couldn't read this file"** error state.

## States to include
Manual add: default, validation-error. Import: upload (empty), parsed-preview (clean), preview-with-errors, applying (busy), done-summary, unreadable-file.

## Content realism (use real data, not lorem)
Brands **Zebronics** & **LG**. Categories **Speakers / Charging Cables / Power Banks**. Names like *"SPK-PSPK 44 (ASTRA 40 BLACK)"*, *"Micro Usb Cable MU240"*, *"ADAPTOR (MA104B WHITE) ZEB"*. ₹ en-IN prices (`₹600`, `₹1,820`, `₹9,138`), some rows **unpriced (TBD)**. Show a realistic mix of New / Updated / Error in the preview.

## Grammar reminders
Mono for every figure. Flat status tags with a leading square (New = accent, Updated = ink/grey, Error = red — never amber). Hairline table rules, 2px corners, no shadows/gradients. One filled-accent action per screen. PC = a roomy table; phone = the same as a stacked full-screen sheet with the table scrolling horizontally inside its own container (never scroll the page body sideways).
