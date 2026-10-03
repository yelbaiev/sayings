-- Corrects base amounts converted without minor-unit scaling.
--
-- Until 1.4.2 every conversion was `amount_minor * rate`, which is only right when both currencies
-- have two decimals. JPY, KRW, ISK and VND have none and TND has three, so a ¥1 000 coffee in a
-- hryvnia household was stored as ₴2.70 instead of ₴270 — 100× too small (TND: 10× too large).
--
-- The fix is the scale the conversion left out: 10^(digits of the base − digits of the currency).
-- Digits are spelled out here rather than read from shared/currencies.ts because a migration must
-- mean the same thing forever; these five are every non-two-digit currency that file lists.
--
-- Idempotent. Only rows whose stored figure still equals the unscaled product are touched, and a
-- corrected row no longer does, so a re-run (after a failure part-way) changes nothing further.
-- Rows that need no scaling (both currencies two-digit) are never matched.
--
-- The touched rows get a fresh rev and updated_at, so phones pull the corrected figure — a rewrite
-- at the old rev would never reach them.

UPDATE household_seq SET rev = rev + 1 WHERE household_id = 'hh_default';

UPDATE transactions
   SET base_amount_minor = CAST(ROUND(amount_minor * fx_rate * (
         CASE (CASE COALESCE(fx_base, (SELECT base_currency FROM households WHERE id = 'hh_default'))
                 WHEN 'ISK' THEN 0 WHEN 'JPY' THEN 0 WHEN 'KRW' THEN 0 WHEN 'VND' THEN 0
                 WHEN 'TND' THEN 3 ELSE 2 END)
            - (CASE currency
                 WHEN 'ISK' THEN 0 WHEN 'JPY' THEN 0 WHEN 'KRW' THEN 0 WHEN 'VND' THEN 0
                 WHEN 'TND' THEN 3 ELSE 2 END)
           WHEN -3 THEN 0.001 WHEN -2 THEN 0.01 WHEN -1 THEN 0.1
           WHEN 1 THEN 10 WHEN 2 THEN 100 WHEN 3 THEN 1000 ELSE 1 END
       )) AS INTEGER),
       rev = (SELECT rev FROM household_seq WHERE household_id = 'hh_default'),
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE deleted = 0
   AND currency != COALESCE(fx_base, (SELECT base_currency FROM households WHERE id = 'hh_default'))
   AND (CASE COALESCE(fx_base, (SELECT base_currency FROM households WHERE id = 'hh_default'))
          WHEN 'ISK' THEN 0 WHEN 'JPY' THEN 0 WHEN 'KRW' THEN 0 WHEN 'VND' THEN 0
          WHEN 'TND' THEN 3 ELSE 2 END)
     != (CASE currency
          WHEN 'ISK' THEN 0 WHEN 'JPY' THEN 0 WHEN 'KRW' THEN 0 WHEN 'VND' THEN 0
          WHEN 'TND' THEN 3 ELSE 2 END)
   AND base_amount_minor = CAST(ROUND(amount_minor * fx_rate) AS INTEGER);
