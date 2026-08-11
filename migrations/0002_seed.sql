-- Seeds the single household and its category list, taken from a Saldo export.
-- Ordering is that export's most recent year of spend, descending — which
-- doubles as the cold-start ordering for the entry screen's predicted category tiles,
-- so they are useful on day one, before any history exists.
--
-- Everything here is created at rev 1, not rev 0: a fresh client syncs from cursor 0 and
-- receives rows where rev > cursor, so rev 0 rows would be invisible forever.
--
-- Members are deliberately NOT seeded. Emails are not hardcoded anywhere; the Worker
-- provisions a member row on first authenticated request (see worker/db.ts ensureMember).
-- Cloudflare Access is the gate that decides who may reach that point.

INSERT OR IGNORE INTO households (id, name, base_currency, created_at)
VALUES ('hh_default', 'Household', 'UAH', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

INSERT OR IGNORE INTO household_seq (household_id, rev) VALUES ('hh_default', 1);

INSERT OR IGNORE INTO categories (id, household_id, kind, name, icon, color, sort_order, rev, updated_at)
VALUES
  -- Expenses, in descending order of 2026 spend.
  ('cat_groceries',    'hh_default', 'expense', 'Groceries',             '🛒',  '#E5484D',  1, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_travel',       'hh_default', 'expense', 'Travel',                '✈️',  '#3E63DD',  2, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_home',         'hh_default', 'expense', 'Home',                  '🏠',  '#8E4EC6',  3, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_transport',    'hh_default', 'expense', 'Transport',             '🚗',  '#0091FF',  4, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_sport',        'hh_default', 'expense', 'Sport',                 '⚽',  '#30A46C',  5, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_parents',      'hh_default', 'expense', 'Parents',               '👴',  '#F76B15',  6, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_family_care',  'hh_default', 'expense', 'Family care',           '👶',  '#E93D82',  7, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_eating_out',   'hh_default', 'expense', 'Eating out',            '🍽️',  '#FFB224',  8, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_clothing',     'hh_default', 'expense', 'Clothing',              '👕',  '#7C66DC',  9, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_gifts_exp',    'hh_default', 'expense', 'Gifts',                 '🎁',  '#D6409F', 10, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_health',       'hh_default', 'expense', 'Health',                '💊',  '#12A594', 11, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_digital',      'hh_default', 'expense', 'Digital',               '💻',  '#5B5BD6', 12, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  -- 'Document ' in the source CSV carries a trailing space; stored trimmed.
  ('cat_document',     'hh_default', 'expense', 'Document',              '📄',  '#6E6E76', 13, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_other_exp',    'hh_default', 'expense', 'Other expense',         '📦',  '#6E6E76', 14, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_pets',         'hh_default', 'expense', 'Pets',                  '🐾',  '#BD4B00', 15, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_uncat_exp',    'hh_default', 'expense', 'Uncategorised expense', '❓',  '#8E8E96', 16, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_books_toys',   'hh_default', 'expense', 'Books and toys',        '📚',  '#AB6400', 17, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_electronics',  'hh_default', 'expense', 'Electronics',           '🔌',  '#00749E', 18, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_education',    'hh_default', 'expense', 'Education',             '🎓',  '#3358D4', 19, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_fees',         'hh_default', 'expense', 'Fees',                  '🧾',  '#6E6E76', 20, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  -- 'work' is lowercase in the source CSV; stored capitalised, with an importer alias.
  ('cat_work',         'hh_default', 'expense', 'Work',                  '💼',  '#5B5BD6', 21, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_charity',      'hh_default', 'expense', 'Charity',               '🤝',  '#30A46C', 22, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_balance_exp',  'hh_default', 'expense', 'Balance correction',    '⚖️',  '#8E8E96', 23, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_entertainment','hh_default', 'expense', 'Entertainment',         '🎬',  '#8E4EC6', 24, 1, CAST(strftime('%s','now') AS INTEGER)*1000),

  -- Income, in descending order of 2026 total.
  ('cat_salary',       'hh_default', 'income',  'Salary',                '💰',  '#30A46C',  1, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_balance_inc',  'hh_default', 'income',  'Balance correction',    '⚖️',  '#8E8E96',  2, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_other_inc',    'hh_default', 'income',  'Other income',          '📥',  '#6E6E76',  3, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_sale',         'hh_default', 'income',  'Sale',                  '🏷️',  '#0091FF',  4, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_gifts_inc',    'hh_default', 'income',  'Gifts',                 '🎁',  '#D6409F',  5, 1, CAST(strftime('%s','now') AS INTEGER)*1000),
  ('cat_uncat_inc',    'hh_default', 'income',  'Uncategorised income',  '❓',  '#8E8E96',  6, 1, CAST(strftime('%s','now') AS INTEGER)*1000);

-- UAH is the base currency, so its rate is 1 by definition rather than by lookup.
-- Dated at the epoch so a nearest-prior search always finds it.
INSERT OR IGNORE INTO fx_rates (on_date, quote, rate, source) VALUES ('1970-01-01', 'UAH', 1.0, 'base');
