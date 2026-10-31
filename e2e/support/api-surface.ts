import { readFileSync } from "node:fs";
import ts from "typescript";

export type ApiFunction = { name: string; args: Record<string, unknown> };

/**
 * Every table, view and function in the `public` schema, read from the
 * generated src/lib/supabase/database.types.ts, with placeholder arguments for
 * each function. Regenerating types after a migration (`npm run db:types`)
 * automatically adds new objects to the anonymous-access checks.
 */
export function publicApiSurface(file = "src/lib/supabase/database.types.ts") {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const result = { tables: [] as string[], views: [] as string[], functions: [] as ApiFunction[] };

  const props = (node: ts.Node | undefined): ts.PropertySignature[] => {
    if (!node) return [];
    if (ts.isUnionTypeNode(node)) return props(node.types[0]); // overloads: the first signature is enough
    return ts.isTypeLiteralNode(node) ? node.members.filter(ts.isPropertySignature) : [];
  };
  const nameOf = (m: ts.PropertySignature) => m.name.getText(source).replace(/^["']|["']$/g, "");

  ts.forEachChild(source, (node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== "Database") return;
    const schema = props(node.type).find((m) => nameOf(m) === "public");
    for (const section of props(schema?.type)) {
      const entries = props(section.type);
      switch (nameOf(section)) {
        case "Tables":
          result.tables = entries.map(nameOf);
          break;
        case "Views":
          result.views = entries.map(nameOf);
          break;
        case "Functions":
          result.functions = entries.map((fn) => {
            const argsNode = props(fn.type).find((m) => nameOf(m) === "Args")?.type;
            const args = Object.fromEntries(
              props(argsNode).map((a) => [nameOf(a), placeholder(nameOf(a), a.type?.getText(source) ?? "")]),
            );
            return { name: nameOf(fn), args };
          });
          break;
      }
    }
  });

  if (!result.tables.length) throw new Error(`Couldn't read the public schema from ${file}`);
  return result;
}

/** A harmless value of the right shape, so PostgREST finds the function and checks permissions. */
function placeholder(name: string, type: string): unknown {
  // Strings that Postgres casts to other types must parse, or the call fails before the permission check.
  if (/time$/.test(name)) return "18:00";
  if (/now$|_at$/.test(name)) return new Date().toISOString();
  if (/timezone$|^tz$/.test(name)) return "UTC";
  if (type.endsWith("[]")) return [];
  if (type.startsWith("number")) return 1;
  if (type.startsWith("boolean")) return false;
  if (type.startsWith("Json")) return [];
  if (type.startsWith("string")) return "00000000-0000-4000-a000-000000000000";
  return null;
}
