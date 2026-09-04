// Локальный прогон воркера на node:http с тестовыми данными.
// Живёт в проекте, а не во временной папке, чтобы переживать перезапуски.
import { createServer } from "node:http";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register(new URL("./html-loader.mjs", import.meta.url));

const { makeD1 } = await import("./d1shim.mjs");
const root = new URL("../", import.meta.url);
const worker = (await import(new URL("src/index.js", root))).default;

const env = {
  DB: makeD1(readFileSync(new URL("schema.sql", root), "utf8")),
  API_TOKEN: "local-test-token",
  TZ_OFFSET_MINUTES: "180",
};

// Тестовые данные, разбросанные по дням текущего месяца.
const cats = (await env.DB.prepare("SELECT * FROM categories").all()).results;
const pick = (name, income = 0) => cats.find((c) => c.name === name && c.is_income === income);
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const today = now.getDate();

const plan = [
  ["Зарплата", 1, 80000, "", 1], ["Аванс", 15, 45000, "", 1], ["Подработка", 9, 28000, "макет", 1],
  ["Дом", 1, 18000, "аренда"], ["Дом", 3, 1400, "интернет"], ["Дом", 12, 5560, "коммуналка"],
  ["Еда", 2, 2540, "Пятёрочка"], ["Еда", 5, 1890, "ВкусВилл"], ["Еда", 9, 980, "рынок"],
  ["Еда", 14, 3120, "Магнит"], ["Еда", 19, 1450, ""], ["Еда", 22, 2270, "Пятёрочка"],
  ["Кафе", 2, 300, "завтрак"], ["Кафе", 6, 1300, "обед"], ["Кафе", 11, 890, "кофе"],
  ["Кафе", 16, 2400, "бар"], ["Кафе", 21, 920, "завтрак"],
  ["Транспорт", 4, 1800, "бензин"], ["Транспорт", 8, 350, ""], ["Транспорт", 13, 990, "такси"],
  ["Здоровье", 7, 2300, "аптека"], ["Здоровье", 18, 4100, "стоматолог"],
  ["Развлечения", 10, 4500, "концерт"], ["Развлечения", 17, 990, ""],
  ["Покупки", 6, 7600, "куртка"], ["Покупки", 20, 14680, "техника"],
  ["Подписки", 3, 800, "сериалы"], ["Подписки", 3, 299, "музыка"],
  ["Прочее", 23, 560, ""],
];

for (const [name, day, rub, note, income = 0] of plan) {
  if (day > today) continue;
  const category = pick(name, income);
  await env.DB.prepare(
    `INSERT INTO entries (amount_kop, is_income, category_id, cat_name, cat_emoji, cat_color, note, local_date, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(rub * 100, income, category.id, category.name, category.emoji, category.color,
         note, `${month}-${String(day).padStart(2, "0")}`, new Date().toISOString()).run();
}

createServer(async (req, res) => {
  const request = new Request("http://localhost:8787" + req.url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise((ok) => {
      let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => ok(data));
    }),
  });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787, () => console.log("Копейка на http://localhost:8787"));
