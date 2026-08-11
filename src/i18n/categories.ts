import type { Locale } from "@shared/currency";

/**
 * Display names for the *seeded* categories, in the three interface languages.
 *
 * Category names are user data — rows in the database, freely renameable — so they cannot live in
 * the message catalogues. But the thirty seeded ones are ours, and an app whose chrome switches to
 * English while the picker stays Russian looks broken in exactly the way a demo cannot afford.
 *
 * The rule that keeps this honest: a name is translated only while it still *is* one of ours —
 * the stored value matches one of the three variants for that id. The moment someone renames
 * "Кафе и рестораны" to "Кофейни", every language shows "Кофейни": a rename is a statement, and
 * a translation table that argues with it would be overwriting user data at display time.
 *
 * English doubles as the canonical seed spelling (migrations/0002_seed.sql), so a fresh install
 * is covered by the same match.
 */

type SeededNames = Record<Locale, string>;

const SEEDED: Record<string, SeededNames> = {
  cat_groceries: { en: "Groceries", ru: "Продукты", uk: "Продукти" },
  cat_travel: { en: "Travel", ru: "Путешествия", uk: "Подорожі" },
  cat_home: { en: "Home", ru: "Дом", uk: "Дім" },
  cat_transport: { en: "Transport", ru: "Транспорт", uk: "Транспорт" },
  cat_sport: { en: "Sport", ru: "Спорт", uk: "Спорт" },
  cat_parents: { en: "Parents", ru: "Родители", uk: "Батьки" },
  cat_family_care: { en: "Family care", ru: "Забота о семье", uk: "Турбота про сім'ю" },
  cat_eating_out: { en: "Eating out", ru: "Кафе и рестораны", uk: "Кафе та ресторани" },
  cat_clothing: { en: "Clothing", ru: "Одежда", uk: "Одяг" },
  cat_gifts_exp: { en: "Gifts", ru: "Подарки", uk: "Подарунки" },
  cat_health: { en: "Health", ru: "Здоровье", uk: "Здоров'я" },
  cat_digital: { en: "Digital", ru: "Цифровые сервисы", uk: "Цифрові сервіси" },
  cat_document: { en: "Document", ru: "Документы", uk: "Документи" },
  cat_other_exp: { en: "Other expense", ru: "Прочие расходы", uk: "Інші витрати" },
  cat_pets: { en: "Pets", ru: "Питомцы", uk: "Улюбленці" },
  cat_uncat_exp: { en: "Uncategorised expense", ru: "Без категории", uk: "Без категорії" },
  cat_books_toys: { en: "Books and toys", ru: "Книги и игрушки", uk: "Книги та іграшки" },
  cat_electronics: { en: "Electronics", ru: "Электроника", uk: "Електроніка" },
  cat_education: { en: "Education", ru: "Образование", uk: "Освіта" },
  cat_fees: { en: "Fees", ru: "Сборы и комиссии", uk: "Збори та комісії" },
  cat_work: { en: "Work", ru: "Работа", uk: "Робота" },
  cat_charity: { en: "Charity", ru: "Благотворительность", uk: "Благодійність" },
  cat_balance_exp: { en: "Balance correction", ru: "Коррекция баланса", uk: "Корекція балансу" },
  cat_entertainment: { en: "Entertainment", ru: "Развлечения", uk: "Розваги" },
  cat_salary: { en: "Salary", ru: "Зарплата", uk: "Зарплата" },
  cat_balance_inc: { en: "Balance correction", ru: "Коррекция баланса", uk: "Корекція балансу" },
  cat_other_inc: { en: "Other income", ru: "Прочие доходы", uk: "Інші доходи" },
  cat_sale: { en: "Sale", ru: "Продажи", uk: "Продажі" },
  cat_gifts_inc: { en: "Gifts", ru: "Подарки", uk: "Подарунки" },
  cat_uncat_inc: { en: "Uncategorised income", ru: "Без категории", uk: "Без категорії" },
};

/** The stored name, translated when it is still the seeded one; verbatim in every other case. */
export function localizedCategoryName(id: string, name: string, locale: Locale): string {
  const seeded = SEEDED[id];
  if (!seeded) return name;
  if (seeded.en !== name && seeded.ru !== name && seeded.uk !== name) return name;
  return seeded[locale];
}
