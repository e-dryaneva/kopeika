import { register } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
register(new URL("./html-loader.mjs", import.meta.url));

const { makeD1 } = await import("./d1shim.mjs");
const root = new URL("../", import.meta.url).pathname;
const worker = (await import(pathToFileURL(root + "src/index.js"))).default;

const env = {
  DB: makeD1(readFileSync(root + "schema.sql", "utf8")),
  API_TOKEN: "secret-token",
  TZ_OFFSET_MINUTES: "180",
};

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        ждали: ${JSON.stringify(expected)}\n        вышло: ${JSON.stringify(actual)}`}`);
};

const call = (path, { method = "GET", body, token = "secret-token" } = {}) =>
  worker.fetch(new Request("https://kopeika.dev" + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
const jcall = async (...args) => (await call(...args)).json();

// --- Доступ ---
check("без токена — 401", (await call("/api/bootstrap", { token: "wrong" })).status, 401);

// --- Справочники ---
let boot = await jcall("/api/bootstrap");
check("категорий из сида", boot.categories.length, 15);
check("расходных категорий", boot.categories.filter((c) => !c.is_income).length, 9);
check("лимит по умолчанию", boot.settings.monthly_budget_kop, 9500000);
check("первая категория", [boot.categories[0].name, boot.categories[0].emoji], ["Еда", "🍞"]);

const idOf = (name, income = 0) =>
  boot.categories.find((c) => c.name === name && c.is_income === income).id;

// --- Свободный ввод ---
let res = await jcall("/api/entry", { method: "POST", body: { text: "500 такси домой" } });
check("«500 такси домой» → категория", res.entry.cat_name, "Транспорт");
check("«500 такси домой» → копейки", res.entry.amount_kop, 50000);
check("«500 такси домой» → заметка", res.entry.note, "домой");
check("снимок эмодзи в операции", res.entry.cat_emoji, "🚌");

res = await jcall("/api/entry", { method: "POST", body: { text: "+80000 зарплата" } });
check("«+80000 зарплата» → доход", res.entry.is_income, 1);

res = await jcall("/api/entry", { method: "POST", body: { text: "1 200,50 кофе с собой" } });
check("«1 200,50 кофе» → Кафе", res.entry.cat_name, "Кафе");
check("«1 200,50» → копейки", res.entry.amount_kop, 120050);
check("заметка", res.entry.note, "с собой");

res = await jcall("/api/entry", { method: "POST", body: { text: "300" } });
check("голая сумма → Прочее (расход)", [res.entry.cat_name, res.entry.is_income], ["Прочее", 0]);

res = await jcall("/api/entry", { method: "POST", body: { text: "+4000" } });
check("«+4000» → Прочее (доход)", [res.entry.cat_name, res.entry.is_income], ["Прочее", 1]);

// --- Лимит в тексте уведомления ---
res = await jcall("/api/entry", { method: "POST", body: { text: "250 обед" } });
console.log("        уведомление:", res.message);
check("в уведомлении остаток лимита", res.message.includes("Осталось в"), true);
check("остаток = лимит − расходы", res.month.remaining_kop, 9500000 - res.month.expense);

// --- Явные поля ---
res = await jcall("/api/entry", { method: "POST", body: { amount: "99,90", category_id: idOf("Еда") } });
check("по category_id", [res.entry.cat_name, res.entry.amount_kop], ["Еда", 9990]);
res = await jcall("/api/entry", { method: "POST", body: { amount: "1 250,50", category_id: idOf("Еда") } });
check("сумма с разделителем разрядов", res.entry.amount_kop, 125050);
res = await jcall("/api/entry", { method: "POST", body: { amount: 700, category: "Покупки" } });
check("по названию категории", res.entry.cat_name, "Покупки");

check("нет суммы — 400", (await call("/api/entry", { method: "POST", body: { amount: 0 } })).status, 400);
check("чужая категория — 400",
      (await call("/api/entry", { method: "POST", body: { amount: 10, category: "динозавры" } })).status, 400);

// --- Свои категории ---
const made = await jcall("/api/categories", { method: "POST", body: { name: "Кот", emoji: "🐈", color: "#FFD60A" } });
check("категория создана", [made.category.name, made.category.is_income], ["Кот", 0]);

res = await jcall("/api/entry", { method: "POST", body: { text: "1500 кот корм" } });
check("новая категория узнаётся по имени", res.entry.cat_name, "Кот");
check("остаток строки — заметка", res.entry.note, "корм");

await jcall(`/api/categories/${made.category.id}`, { method: "PATCH", body: { name: "Кошка", color: "#FF375F" } });
const month = new Date(Date.now() + 180 * 60000).toISOString().slice(0, 7);
let list = await jcall(`/api/entries?month=${month}`);
let catEntry = list.entries.find((e) => e.category_id === made.category.id);
check("переименование видно в истории", [catEntry.cat_name, catEntry.cat_color], ["Кошка", "#FF375F"]);

await jcall(`/api/categories/${made.category.id}`, { method: "DELETE" });
list = await jcall(`/api/entries?month=${month}`);
catEntry = list.entries.find((e) => e.note === "корм");
check("после удаления операция цела", [catEntry.cat_name, catEntry.cat_emoji, catEntry.category_id],
      ["Кошка", "🐈", null]);
check("категорий снова 15", (await jcall("/api/bootstrap")).categories.length, 15);

// --- Лимит ---
res = await jcall("/api/settings", { method: "PUT", body: { monthly_budget_kop: 12000000 } });
check("лимит сохранён", res.settings.monthly_budget_kop, 12000000);
check("остаток пересчитан",
      (await jcall(`/api/entries?month=${month}`)).totals.remaining_kop,
      12000000 - (await jcall(`/api/entries?month=${month}`)).totals.expense);

// --- Лимиты по категориям ---
boot = await jcall("/api/bootstrap");
check("по умолчанию лимита нет", boot.categories.every((c) => c.limit_kop === 0), true);

res = await jcall(`/api/categories/${idOf("Еда")}`, { method: "PATCH", body: { limit_kop: 1500000 } });
check("лимит категории сохранён", res.category.limit_kop, 1500000);
check("имя не пострадало", res.category.name, "Еда");

res = await jcall(`/api/categories/${idOf("Еда")}`, { method: "PATCH", body: { color: "#FFD60A" } });
check("правка цвета не сбрасывает лимит", [res.category.color, res.category.limit_kop], ["#FFD60A", 1500000]);

res = await jcall(`/api/categories/${idOf("Еда")}`, { method: "PATCH", body: { limit_kop: -50 } });
check("отрицательный лимит обнуляется", res.category.limit_kop, 0);

boot = await jcall("/api/bootstrap");
check("лимит виден в справочнике",
      boot.categories.find((c) => c.name === "Еда" && !c.is_income).limit_kop, 0);

// --- Список и удаление ---
list = await jcall(`/api/entries?month=${month}`);
const before = list.entries.length;
await call(`/api/entry/${list.entries[0].id}`, { method: "DELETE" });
check("операция удалена", (await jcall(`/api/entries?month=${month}`)).entries.length, before - 1);

check("пустой месяц", (await jcall("/api/entries?month=2020-01")).totals.expense, 0);
check("кривой month — 400", (await call("/api/entries?month=абв")).status, 400);

// --- Изменение операции ---
res = await jcall("/api/entry", { method: "POST", body: { text: "1000 еда" } });
const editId = res.entry.id;

res = await jcall(`/api/entry/${editId}`, { method: "PATCH", body: { amount: "1 250,50" } });
check("сумма изменена", res.entry.amount_kop, 125050);
check("остальное не тронуто", [res.entry.cat_name, res.entry.note], ["Еда", ""]);

res = await jcall(`/api/entry/${editId}`, { method: "PATCH", body: { category_id: idOf("Транспорт"), note: "такси" } });
check("категория изменена", [res.entry.cat_name, res.entry.cat_emoji], ["Транспорт", "🚌"]);
check("заметка изменена", res.entry.note, "такси");
check("сумма сохранилась", res.entry.amount_kop, 125050);

res = await jcall(`/api/entry/${editId}`, { method: "PATCH", body: { category_id: idOf("Зарплата", 1) } });
check("смена на доходную категорию меняет знак", res.entry.is_income, 1);

const otherMonth = `${month}-01` === `${month}-01` ? "2026-01-15" : "2026-01-15";
res = await jcall(`/api/entry/${editId}`, { method: "PATCH", body: { local_date: otherMonth } });
check("дата изменена", res.entry.local_date, otherMonth);
check("операция ушла из текущего месяца",
      (await jcall(`/api/entries?month=${month}`)).entries.some((e) => e.id === editId), false);
check("и появилась в новом",
      (await jcall("/api/entries?month=2026-01")).entries.some((e) => e.id === editId), true);

check("нулевая сумма — 400",
      (await call(`/api/entry/${editId}`, { method: "PATCH", body: { amount: 0 } })).status, 400);
check("кривая дата — 400",
      (await call(`/api/entry/${editId}`, { method: "PATCH", body: { local_date: "вчера" } })).status, 400);
check("чужая категория — 400",
      (await call(`/api/entry/${editId}`, { method: "PATCH", body: { category_id: 99999 } })).status, 400);
check("несуществующая операция — 404",
      (await call("/api/entry/999999", { method: "PATCH", body: { amount: 5 } })).status, 404);

// --- Статика ---
check("страница отдаётся", (await call("/")).status, 200);
check("иконка отдаётся", (await call("/icon.png")).status, 200);
check("манифест отдаётся", (await call("/manifest.webmanifest")).status, 200);

console.log(failures ? `\n${failures} провалено` : "\nвсе проверки прошли");
process.exit(failures ? 1 : 0);
