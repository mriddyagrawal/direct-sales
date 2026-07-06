-- M1.7: seed Zebronics brand + 42 products from data/ZebronicsPriceList.csv
-- Source of truth: docs/specs/seed-data.md
--
-- Transformation applied by hand (the drift-protected scripts/seed.ts loader
-- needs the Node/Next app, not yet scaffolded — noted as a follow-up, not a
-- blocker for M1: the first load into an empty table has no drift to guard
-- against):
--   - category normalization (ADAPTOR->Adaptors, Adaptor with Cable->Adaptors
--     with Cable, Charging Cable->Charging Cables, Eare Phones->Earphones,
--     Power Bank->Power Banks, SPEAKER->Speakers), display order = CSV
--     first-appearance order.
--   - SKU = ZEB-<CODE>-<NN>, NN = 2-digit position within category in CSV
--     row order (ADP/AWC/CBL/EAR/PWR/SPK).
--   - names verbatim except trim + collapse internal whitespace runs; typos
--     preserved ("Balck", "Bannk", "Lighting", "Eare Phones" -> category
--     "Earphones" but the per-row name typo itself is untouched elsewhere).
--     Two rows had a doubled-space run needing collapse: CBL-01 ("Lighting
--     LT200"), CBL-04 ("-TT65 (RED)").
--   - TBD -> price_paise NULL (8 rows: EAR-05/06, PWR-02/05, SPK-10/12/13/14);
--     otherwise whole-rupee integer x100 -> paise.
--   - insert ... on conflict (sku) do update: idempotent re-application of
--     this same seed is a no-op change (upsert lands on the same values).

do $$
declare
  v_brand_id uuid;
begin
  insert into public.brands (name, active)
  values ('Zebronics', true)
  on conflict (name) do update set active = true
  returning id into v_brand_id;

  insert into public.products (brand_id, category, name, sku, price_paise, active, tally_name)
  values
    (v_brand_id, 'Adaptors', 'ADAPTOR 33W MULTIPROTOCOL (MA203 PRO) A279', 'ZEB-ADP-01', 52300, true, null),
    (v_brand_id, 'Adaptors', 'ADAPTOR 35W DUAL PD PORT (MA101B WHITE)', 'ZEB-ADP-02', 71800, true, null),
    (v_brand_id, 'Adaptors', 'ADAPTOR (MA104B WHITE) ZEB', 'ZEB-ADP-03', 36400, true, null),
    (v_brand_id, 'Adaptors', 'ADAPTOR (MA108B WHITE)', 'ZEB-ADP-04', 38000, true, null),

    (v_brand_id, 'Adaptors with Cable', 'ADAPTOR WITH MICRO USB CABLE (MA200 WHITE)', 'ZEB-AWC-01', 17900, true, null),
    (v_brand_id, 'Adaptors with Cable', 'ADAPTOR WITH TYPE C CABLE (MA100B WHITE)', 'ZEB-AWC-02', 33000, true, null),
    (v_brand_id, 'Adaptors with Cable', 'ADAPTOR WITH TYPE C CABLE (MA200 WHITE)', 'ZEB-AWC-03', 19500, true, null),
    (v_brand_id, 'Adaptors with Cable', 'ADAPTOR WITH TYPE C USB CABLE ( MA110B)', 'ZEB-AWC-04', 17800, true, null),
    (v_brand_id, 'Adaptors with Cable', 'CAR CHARGER WITH TYPE C CABLE CC242A3 (BLACK)', 'ZEB-AWC-05', 18600, true, null),
    (v_brand_id, 'Adaptors with Cable', 'CAR CHARGER WITH TYPE C CABLE CC38(BLACK)', 'ZEB-AWC-06', 39700, true, null),

    (v_brand_id, 'Charging Cables', 'Cable Type C to Lighting LT200 (White)Zeb', 'ZEB-CBL-01', 25300, true, null),
    (v_brand_id, 'Charging Cables', 'Micro Usb Cable MU240 - ZB CABLE (White)', 'ZEB-CBL-02', 6000, true, null),
    (v_brand_id, 'Charging Cables', 'TYPE C TO TYPE C CABLE TT27 PLUS (BLACK)', 'ZEB-CBL-03', 10100, true, null),
    (v_brand_id, 'Charging Cables', 'TYPE C TO TYPE C CABLE -TT65 (RED)', 'ZEB-CBL-04', 13500, true, null),
    (v_brand_id, 'Charging Cables', 'USB TO TYPE C CABLE TU240P PLUS (WHITE)', 'ZEB-CBL-05', 7200, true, null),
    (v_brand_id, 'Charging Cables', 'USB TO TYPE C CABLE ZEB-UT65 (RED)', 'ZEB-CBL-06', 16600, true, null),

    (v_brand_id, 'Earphones', 'EARBUDS PODS 416 BTH (CHIME R BLACK)', 'ZEB-EAR-01', 82500, true, null),
    (v_brand_id, 'Earphones', 'Eare Buds BTH (PODS ZI 12 WHITE)', 'ZEB-EAR-02', 80000, true, null),
    (v_brand_id, 'Earphones', 'Headphone WHP 11 BTH (PARADISE NEO R BLACK)', 'ZEB-EAR-03', 82500, true, null),
    (v_brand_id, 'Earphones', 'Headphone WHP 8 BTH (PARADISE PLUS BLACK)', 'ZEB-EAR-04', 88700, true, null),
    (v_brand_id, 'Earphones', 'H-ESCAPE 10 ZEB BLUETOOTH EARPHONE NBI 5 GREY', 'ZEB-EAR-05', null, true, null),
    (v_brand_id, 'Earphones', 'H-ESCAPE 90 ZEB BLUETOOTH EARPHONE (SNB 2 BLACK)', 'ZEB-EAR-06', null, true, null),
    (v_brand_id, 'Earphones', 'STEREO EARPHONE WITH MIC (ARIA BLUE)', 'ZEB-EAR-07', 21900, true, null),

    (v_brand_id, 'Power Banks', 'Power Bank A267-ZEB MW70 10000MAH (BLACK)', 'ZEB-PWR-01', 135000, true, null),
    (v_brand_id, 'Power Banks', 'POWER BANK A267-ZEB MW70 10000MAH CHARGER (WHITE)', 'ZEB-PWR-02', null, true, null),
    (v_brand_id, 'Power Banks', 'Power Bank OD PB17 10000 MAH (Black)', 'ZEB-PWR-03', 55700, true, null),
    (v_brand_id, 'Power Banks', 'Power Bank ZEB-MB 10000S10 PRO(Balck)', 'ZEB-PWR-04', 63400, true, null),
    (v_brand_id, 'Power Banks', 'Power Bannk 20000R5 PRO (BLACK)', 'ZEB-PWR-05', null, true, null),

    (v_brand_id, 'Speakers', 'Bar Speaker JUKEBAR 2500 WITH 2 MIC (SBSPK1)', 'ZEB-SPK-01', 395100, true, null),
    (v_brand_id, 'Speakers', 'SPK-KSPK 7 PORTABLE BTH SPEAKER (BUDDY 150)', 'ZEB-SPK-02', 312900, true, null),
    (v_brand_id, 'Speakers', 'SPK - PORTABLE BTH SPEAKER (SONO PLUS)', 'ZEB-SPK-03', 455000, true, null),
    (v_brand_id, 'Speakers', 'SPK-PSPK 44 PORTABLE BTH SPEAKER (ASTRA 40 BLACK)', 'ZEB-SPK-04', 102900, true, null),
    (v_brand_id, 'Speakers', 'SPK-PSPK 48 PORTABLE BTH SPEAKER (COUNTY PLUS BLACK)', 'ZEB-SPK-05', 75200, true, null),
    (v_brand_id, 'Speakers', 'SPK- PSPK 50 PORTABLE BTH SPEAKER (COUNTY 8 BLACK)', 'ZEB-SPK-06', 56600, true, null),
    (v_brand_id, 'Speakers', 'SPK- PSPK 52 PORTABLE BTH SPEAKER (ZEST 11)', 'ZEB-SPK-07', 65800, true, null),
    (v_brand_id, 'Speakers', 'SPK-PSPK 8 PORTABLE BTH SPEAKER (BUDDY 100)', 'ZEB-SPK-08', 147700, true, null),
    (v_brand_id, 'Speakers', 'SPK-THUMP 802 BTH PORTABLE SPEAKER (DSPK 102)', 'ZEB-SPK-09', 913800, true, null),
    (v_brand_id, 'Speakers', 'SPK-ZEB-101 ZEBRONICS BLUETOOTH TROLLEY MONSTER X8L', 'ZEB-SPK-10', null, true, null),
    (v_brand_id, 'Speakers', 'SPK-ZEB COMPUTER MULTIMEDIA 2.1 SOUNDBAR SPEAKER (ABABA 1)', 'ZEB-SPK-11', 725000, true, null),
    (v_brand_id, 'Speakers', 'SPK-ZEBRONICS PORTABLE BLUETOOTH BARREL 200', 'ZEB-SPK-12', null, true, null),
    (v_brand_id, 'Speakers', 'SPK-ZEB SBSPK C17 MULTIMEDIA 2.0 JUKE BAR 1610', 'ZEB-SPK-13', null, true, null),
    (v_brand_id, 'Speakers', 'TROLLEY DJ SPEAKER VIGOR 100', 'ZEB-SPK-14', null, true, null)
  on conflict (sku) do update set
    category    = excluded.category,
    name        = excluded.name,
    price_paise = excluded.price_paise,
    active      = excluded.active;
end $$;
