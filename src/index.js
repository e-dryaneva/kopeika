import pageShell from "./page.html";
import appScript from "./app.script.html";
import { ICON_512_BASE64 } from "./icon.js";
import { PALETTE, fallbackCategory, matchCategory, parseAmountKop, parseText } from "./parse.js";

// Клиентский скрипт лежит отдельным файлом и вклеивается в страницу один раз при старте.
const page = pageShell.replace("<!--APP-->", () => appScript);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** Сравнение без ранней остановки, чтобы по времени ответа нельзя было подбирать токен. */
function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  if (!env.API_TOKEN) return false;
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return tokensMatch(supplied, env.API_TOKEN);
}

const offsetOf = (env) => Number(env.TZ_OFFSET_MINUTES ?? 180) || 0;

/** Дата в местном поясе как YYYY-MM-DD. */
const localDate = (date, offsetMinutes) =>
  new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);

const money = (kop, signed = false) => {
  const rubles = kop / 100;
  const fraction = Number.isInteger(rubles) ? 0 : 2;
  const text = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(Math.abs(rubles));
  if (!signed || rubles === 0) return text;
  return (rubles > 0 ? "+" : "−") + text;
};

const MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне",
                     "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

// MARK: — Чтение справочников

const allCategories = async (env) =>
  (await env.DB.prepare(
    "SELECT id, name, emoji, color, is_income, sort, limit_kop FROM categories ORDER BY sort, id"
  ).all()).results;

async function allSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { monthly_budget_kop: Number(settings.monthly_budget_kop ?? 0) };
}

async function monthTotals(env, month) {
  const { results } = await env.DB.prepare(
    `SELECT is_income, SUM(amount_kop) AS total
       FROM entries WHERE local_date LIKE ?1 GROUP BY is_income`
  ).bind(`${month}-%`).all();

  let income = 0;
  let expense = 0;
  for (const row of results) {
    if (row.is_income) income = row.total;
    else expense = row.total;
  }

  const { monthly_budget_kop: budget } = await allSettings(env);
  return { income, expense, balance: income - expense, budget_kop: budget,
           remaining_kop: budget ? budget - expense : null };
}

// MARK: — Запись операции

async function addEntry(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Ожидался JSON." }, 400);
  }

  const categories = await allCategories(env);
  let amountKop;
  let category;
  let note = typeof body.note === "string" ? body.note.trim() : "";

  if (body.text !== undefined && body.amount === undefined) {
    // Свободный ввод: «500 такси домой».
    const parsed = parseText(body.text, categories);
    if (!parsed) {
      return json({ ok: false, message: "Не разобрал сумму. Пример: 500 еда" }, 400);
    }
    ({ amountKop, category } = parsed);
    note = note || parsed.note;
  } else {
    amountKop = parseAmountKop(body.amount);
    if (amountKop === null) {
      return json({ ok: false, message: "Нужна сумма — число больше нуля." }, 400);
    }

    if (body.category_id !== undefined) {
      category = categories.find((c) => c.id === Number(body.category_id));
      if (!category) {
        return json({ ok: false, message: `Неизвестная категория: ${body.category_id}` }, 400);
      }
    } else if (body.category !== undefined) {
      // Свободное слово из быстрой команды: «кофе» → Кафе, «такси домой» → Транспорт + заметка.
      const raw = String(body.category).trim();
      const guess = matchCategory(raw, categories);
      if (guess.category) {
        category = guess.category;
        if (guess.note) note = note ? `${guess.note} ${note}` : guess.note;
      } else if (raw) {
        // Ничего не узнали — слово не теряем, оно становится заметкой.
        note = note ? `${raw} ${note}` : raw;
      }
    }
    category ??= fallbackCategory(categories, Boolean(body.is_income));
  }

  const now = new Date();
  const date = localDate(now, offsetOf(env));

  const inserted = await env.DB.prepare(
    `INSERT INTO entries (amount_kop, is_income, category_id, cat_name, cat_emoji, cat_color, note, local_date, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     RETURNING id`
  ).bind(amountKop, category.is_income, category.id, category.name,
         category.emoji, category.color, note, date, now.toISOString()).first();

  const totals = await monthTotals(env, date.slice(0, 7));
  const verb = category.is_income ? "Плюс" : "Минус";
  const tail = totals.remaining_kop === null
    ? `За месяц: ${money(totals.balance, true)}`
    : `Осталось в ${MONTHS_PREP[Number(date.slice(5, 7)) - 1]}: ${money(totals.remaining_kop)}`;

  return json({
    ok: true,
    message: `${verb} ${money(amountKop)} — ${category.name}. ${tail}`,
    entry: {
      id: inserted.id, amount_kop: amountKop, is_income: category.is_income,
      category_id: category.id, cat_name: category.name, cat_emoji: category.emoji,
      cat_color: category.color, note, local_date: date,
    },
    month: totals,
  });
}

// MARK: — Изменение операции

async function updateEntry(env, id, body) {
  const existing = await env.DB.prepare("SELECT * FROM entries WHERE id = ?1").bind(id).first();
  if (!existing) return json({ ok: false, message: "Операция не найдена." }, 404);

  // Категорию берём целиком: вместе с ней меняется и знак операции.
  let category = null;
  if (body.category_id !== undefined) {
    const categories = await allCategories(env);
    category = categories.find((c) => c.id === Number(body.category_id));
    if (!category) return json({ ok: false, message: "Неизвестная категория." }, 400);
  }

  let amountKop = existing.amount_kop;
  if (body.amount !== undefined) {
    amountKop = parseAmountKop(body.amount);
    if (amountKop === null) {
      return json({ ok: false, message: "Нужна сумма — число больше нуля." }, 400);
    }
  }

  const date = body.local_date !== undefined ? String(body.local_date) : existing.local_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, message: "Дата должна быть в формате YYYY-MM-DD." }, 400);
  }

  const note = body.note !== undefined ? String(body.note).trim() : existing.note;
  const target = category ?? {
    id: existing.category_id, name: existing.cat_name, emoji: existing.cat_emoji,
    color: existing.cat_color, is_income: existing.is_income,
  };

  const updated = await env.DB.prepare(
    `UPDATE entries
        SET amount_kop = ?2, is_income = ?3, category_id = ?4,
            cat_name = ?5, cat_emoji = ?6, cat_color = ?7, note = ?8, local_date = ?9
      WHERE id = ?1
     RETURNING id, amount_kop, is_income, category_id, cat_name, cat_emoji, cat_color, note, local_date`
  ).bind(id, amountKop, target.is_income, target.id, target.name,
         target.emoji, target.color, note, date).first();

  return json({ ok: true, entry: updated, month: await monthTotals(env, date.slice(0, 7)) });
}

// MARK: — Категории

async function createCategory(env, body) {
  const name = String(body.name ?? "").trim();
  if (!name) return json({ ok: false, message: "Нужно название." }, 400);

  const max = await env.DB.prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM categories").first();
  const created = await env.DB.prepare(
    `INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
     VALUES (?1, ?2, ?3, ?4, ?5, 0)
     RETURNING id, name, emoji, color, is_income, sort, limit_kop`
  ).bind(name, String(body.emoji ?? "📦"), String(body.color ?? PALETTE[0]),
         body.is_income ? 1 : 0, max.m + 1).first();

  return json({ ok: true, category: created });
}

async function updateCategory(env, id, body) {
  const existing = await env.DB.prepare("SELECT * FROM categories WHERE id = ?1").bind(id).first();
  if (!existing) return json({ ok: false, message: "Категория не найдена." }, 404);

  const name = body.name !== undefined ? String(body.name).trim() || existing.name : existing.name;
  const emoji = String(body.emoji ?? existing.emoji);
  const color = String(body.color ?? existing.color);

  const limitKop = body.limit_kop === undefined
    ? existing.limit_kop
    : Math.max(0, Math.round(Number(body.limit_kop) || 0));

  const updated = await env.DB.prepare(
    `UPDATE categories SET name = ?2, emoji = ?3, color = ?4, limit_kop = ?5 WHERE id = ?1
     RETURNING id, name, emoji, color, is_income, sort, limit_kop`
  ).bind(id, name, emoji, color, limitKop).first();

  // Освежаем снимок в операциях, чтобы после удаления категории
  // в истории осталось последнее название, а не то, что было при записи.
  await env.DB.prepare(
    "UPDATE entries SET cat_name = ?2, cat_emoji = ?3, cat_color = ?4 WHERE category_id = ?1"
  ).bind(id, name, emoji, color).run();

  return json({ ok: true, category: updated });
}

async function deleteCategory(env, id) {
  // Операции остаются: у них уже лежит снимок названия, эмодзи и цвета.
  await env.DB.prepare("UPDATE entries SET category_id = NULL WHERE category_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM categories WHERE id = ?1").bind(id).run();
  return json({ ok: true });
}

// MARK: — Операции за месяц

async function listEntries(env, month) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.amount_kop, e.is_income, e.note, e.local_date, e.created_at, e.category_id,
            COALESCE(c.name,  e.cat_name)  AS cat_name,
            COALESCE(c.emoji, e.cat_emoji) AS cat_emoji,
            COALESCE(c.color, e.cat_color) AS cat_color
       FROM entries e
       LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.local_date LIKE ?1
      ORDER BY e.local_date DESC, e.id DESC`
  ).bind(`${month}-%`).all();

  return { month, entries: results, totals: await monthTotals(env, month) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (path === "/icon.png") {
      return new Response(Uint8Array.from(atob(ICON_512_BASE64), (c) => c.charCodeAt(0)), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" },
      });
    }

    if (path === "/manifest.webmanifest") {
      return json({
        name: "Копейка", short_name: "Копейка", start_url: "/", display: "standalone",
        background_color: "#000000", theme_color: "#000000",
        icons: [{ src: "/icon.png", sizes: "180x180", type: "image/png", purpose: "any" }],
      });
    }

    // Дальше — только API, всё под токеном.
    if (!path.startsWith("/api/")) return new Response("Не найдено", { status: 404 });
    if (!authorized(request, env)) return json({ ok: false, message: "Неверный токен." }, 401);

    const body = ["POST", "PATCH", "PUT"].includes(request.method)
      ? await request.clone().json().catch(() => ({}))
      : {};

    if (path === "/api/bootstrap") {
      return json({ ok: true, categories: await allCategories(env),
                    settings: await allSettings(env), palette: PALETTE });
    }

    if (path === "/api/entry" && request.method === "POST") return addEntry(request, env);

    if (path === "/api/entries" && request.method === "GET") {
      const month = url.searchParams.get("month") ?? localDate(new Date(), offsetOf(env)).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return json({ ok: false, message: "month должен быть в формате YYYY-MM." }, 400);
      }
      return json({ ok: true, ...(await listEntries(env, month)) });
    }

    const entryMatch = path.match(/^\/api\/entry\/(\d+)$/);
    if (entryMatch) {
      const id = Number(entryMatch[1]);
      if (request.method === "PATCH") return updateEntry(env, id, body);
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM entries WHERE id = ?1").bind(id).run();
        return json({ ok: true });
      }
    }

    if (path === "/api/categories" && request.method === "POST") return createCategory(env, body);

    const categoryMatch = path.match(/^\/api\/categories\/(\d+)$/);
    if (categoryMatch) {
      const id = Number(categoryMatch[1]);
      if (request.method === "PATCH") return updateCategory(env, id, body);
      if (request.method === "DELETE") return deleteCategory(env, id);
    }

    if (path === "/api/settings" && request.method === "PUT") {
      const budget = Math.max(0, Math.round(Number(body.monthly_budget_kop) || 0));
      await env.DB.prepare(
        `INSERT INTO settings (key, value) VALUES ('monthly_budget_kop', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1`
      ).bind(String(budget)).run();
      return json({ ok: true, settings: await allSettings(env) });
    }

    return json({ ok: false, message: "Нет такого метода." }, 404);
  },
};
