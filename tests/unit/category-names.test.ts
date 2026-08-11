import { describe, expect, it } from "vitest";
import { localizedCategoryName } from "~/i18n/categories";

describe("localizedCategoryName", () => {
  it("follows the interface language while the name is still the seeded one", () => {
    expect(localizedCategoryName("cat_groceries", "Продукты", "en")).toBe("Groceries");
    expect(localizedCategoryName("cat_groceries", "Продукты", "uk")).toBe("Продукти");
    expect(localizedCategoryName("cat_groceries", "Продукты", "ru")).toBe("Продукты");
  });

  it("recognises any of the three variants as 'still seeded'", () => {
    // A fresh install seeds English; an edit saved under another locale writes that locale's
    // variant back. Both must keep translating, or one round-trip would freeze the language.
    expect(localizedCategoryName("cat_eating_out", "Eating out", "ru")).toBe("Кафе и рестораны");
    expect(localizedCategoryName("cat_eating_out", "Кафе та ресторани", "en")).toBe("Eating out");
  });

  it("respects a rename — a translation table must not argue with user data", () => {
    expect(localizedCategoryName("cat_eating_out", "Кофейни", "en")).toBe("Кофейни");
  });

  it("passes a user-created category through untouched", () => {
    expect(localizedCategoryName("cat_custom_abc", "Хобби", "en")).toBe("Хобби");
  });
});
