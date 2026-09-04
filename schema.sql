-- Категории. Пользователь может добавлять, переименовывать, менять цвет и удалять.
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  emoji     TEXT    NOT NULL DEFAULT '📦',
  color     TEXT    NOT NULL DEFAULT '#8E8E93',
  is_income INTEGER NOT NULL DEFAULT 0,
  sort      INTEGER NOT NULL DEFAULT 0,
  -- Лимит расходов по категории на месяц, в копейках. 0 — лимита нет.
  limit_kop INTEGER NOT NULL DEFAULT 0
);

-- Настройки: пока только месячный лимит.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Сумма в копейках, всегда положительная. Знак задаётся через is_income.
  amount_kop  INTEGER NOT NULL,
  is_income   INTEGER NOT NULL DEFAULT 0,
  -- Ссылка на категорию: переименование и смена цвета видны в истории.
  category_id INTEGER,
  -- Снимок на момент записи: если категорию удалят, операция останется читаемой.
  cat_name    TEXT    NOT NULL,
  cat_emoji   TEXT    NOT NULL DEFAULT '📦',
  cat_color   TEXT    NOT NULL DEFAULT '#8E8E93',
  note        TEXT    NOT NULL DEFAULT '',
  -- Дата в местном часовом поясе, YYYY-MM-DD. По ней считаются месяцы.
  local_date  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS entries_by_date ON entries (local_date DESC, id DESC);

INSERT INTO settings (key, value)
SELECT 'monthly_budget_kop', '9500000'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'monthly_budget_kop');

-- Категории по умолчанию. Отдельными вставками: D1 ограничивает
-- число веток в компаунд-SELECT.
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Еда', '🍞', '#FF9500', 0, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Еда' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Кафе', '☕️', '#FF375F', 0, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Кафе' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Транспорт', '🚌', '#0A84FF', 0, 3, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Транспорт' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Дом', '🏠', '#5E5CE6', 0, 4, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Дом' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Здоровье', '💊', '#30D158', 0, 5, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Здоровье' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Развлечения', '🎬', '#BF5AF2', 0, 6, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Развлечения' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Покупки', '🛍', '#64D2FF', 0, 7, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Покупки' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Подписки', '🔁', '#FFD60A', 0, 8, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Подписки' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Прочее', '📦', '#8E8E93', 0, 9, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Прочее' AND is_income = 0);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Зарплата', '💰', '#30D158', 1, 10, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Зарплата' AND is_income = 1);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Аванс', '💵', '#34C759', 1, 11, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Аванс' AND is_income = 1);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Подработка', '💼', '#0A84FF', 1, 12, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Подработка' AND is_income = 1);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Возврат', '↩️', '#64D2FF', 1, 13, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Возврат' AND is_income = 1);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Подарок', '🎁', '#BF5AF2', 1, 14, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Подарок' AND is_income = 1);
INSERT INTO categories (name, emoji, color, is_income, sort, limit_kop)
SELECT 'Прочее', '📦', '#8E8E93', 1, 15, 0
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Прочее' AND is_income = 1);
