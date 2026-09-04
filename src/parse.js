// Разбор строки вида «500 такси домой». Категории приходят из базы,
// поэтому здесь только сумма, знак и подбор категории по словам.

/** Цвета, по которым щёлкает квадратик при редактировании категории. */
export const PALETTE = [
  "#FF9500", "#FF375F", "#0A84FF", "#5E5CE6", "#30D158",
  "#BF5AF2", "#64D2FF", "#FFD60A", "#FF453A", "#8E8E93",
];

/** Слова-синонимы, привязанные к названиям категорий по умолчанию. */
const SYNONYMS = {
  "Еда": ["еда", "продукты", "поесть", "магазин", "пятёрочка", "вкусвилл", "магнит"],
  "Кафе": ["кафе", "кофе", "обед", "завтрак", "ужин", "ресторан", "бар", "доставка"],
  "Транспорт": ["транспорт", "такси", "метро", "бензин", "заправка", "автобус", "самокат", "проезд"],
  "Дом": ["дом", "квартира", "аренда", "жкх", "коммуналка", "интернет", "ремонт"],
  "Здоровье": ["здоровье", "аптека", "врач", "лекарства", "стоматолог", "спорт", "зал"],
  "Развлечения": ["развлечения", "кино", "театр", "концерт", "игры", "отдых"],
  "Покупки": ["покупки", "одежда", "техника", "шмотки", "маркетплейс", "wb", "озон"],
  "Подписки": ["подписки", "подписка", "сериалы", "музыка"],
  "Прочее": ["прочее", "другое", "разное"],
  "Зарплата": ["зарплата", "зп", "оклад"],
  "Аванс": ["аванс"],
  "Подработка": ["подработка", "фриланс", "халтура", "проект"],
  "Возврат": ["возврат", "кэшбек", "кэшбэк", "вернули"],
  "Подарок": ["подарок", "подарили"],
};

const normalize = (word) => word.toLowerCase().replace(/[.,!?;:]+$/, "").replace(/ё/g, "е");

/**
 * Число из пользовательского ввода: «1 250,50», «1250.5», «1 250».
 * Пробелы-разделители разрядов (обычный, неразрывный и узкий) отбрасываются.
 * Возвращает копейки или null.
 */
export function parseAmountKop(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

/** Слово → id категории. Собственное имя категории всегда важнее синонима. */
export function buildLookup(categories) {
  const lookup = new Map();
  for (const [name, words] of Object.entries(SYNONYMS)) {
    const match = categories.find((c) => c.name === name);
    if (!match) continue;
    for (const word of words) {
      if (!lookup.has(normalize(word))) lookup.set(normalize(word), match.id);
    }
  }
  // Имена категорий (включая созданные пользователем) перекрывают синонимы.
  for (const category of categories) lookup.set(normalize(category.name), category.id);
  return lookup;
}

/** Категория «Прочее» нужного знака, иначе первая подходящая. */
export function fallbackCategory(categories, wantIncome) {
  const pool = categories.filter((c) => Boolean(c.is_income) === wantIncome);
  return pool.find((c) => normalize(c.name) === "прочее") ?? pool[0] ?? categories[0];
}

/**
 * Разбирает свободное описание вроде «кофе с собой»: первое узнанное слово
 * становится категорией, остальные — заметкой. Категории нет — вернёт null.
 */
export function matchCategory(text, categories) {
  const lookup = buildLookup(categories);
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);

  let category = null;
  const noteWords = [];
  for (const word of words) {
    const id = lookup.get(normalize(word));
    if (category === null && id !== undefined) {
      category = categories.find((c) => c.id === id);
    } else {
      noteWords.push(word);
    }
  }
  return { category, note: noteWords.join(" ") };
}

/**
 * Возвращает { amountKop, category, note } или null, если суммы в строке нет.
 */
export function parseText(input, categories) {
  const raw = String(input ?? "").trim();
  if (!raw || !categories.length) return null;

  const forcedIncome = raw.startsWith("+");
  const body = raw.replace(/^[+-]\s*/, "");

  // Сумма — в начале строки, возможно с пробелами-разделителями разрядов.
  const match = body.match(/^(\d[\d\s ]*(?:[.,]\d+)?)/);
  if (!match) return null;

  const amount = Number(match[1].replace(/[\s ]/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const lookup = buildLookup(categories);
  const words = body.slice(match[0].length).trim().split(/\s+/).filter(Boolean);

  let category = null;
  const noteWords = [];
  for (const word of words) {
    const id = lookup.get(normalize(word));
    if (category === null && id !== undefined) {
      category = categories.find((c) => c.id === id);
    } else {
      noteWords.push(word);
    }
  }

  // «+500 еда» — знак важнее найденной категории.
  if (!category || (forcedIncome && !category.is_income)) {
    category = fallbackCategory(categories, forcedIncome);
  }

  return {
    amountKop: Math.round(amount * 100),
    category,
    note: noteWords.join(" "),
  };
}
