// Позволяет Node импортировать .html как текст — так же, как это делает Workers.
export async function load(url, context, nextLoad) {
  if (url.endsWith(".html")) {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL(url), "utf8");
    return { format: "module", shortCircuit: true,
             source: `export default ${JSON.stringify(source)};` };
  }
  return nextLoad(url, context);
}
