/**
 * Seed nutrition tables from nutrition-seed.json (SLV + USDA secondary + aliases)
 * and re-resolve all recipes (dual-write).
 *
 * Requires wrangler auth. Run from repo root:
 *   python3 scripts/fetch-slv-catalog.py   # refresh SLV raw (optional)
 *   python3 scripts/build-nutrition-seed-from-slv.py
 *   npx tsx scripts/nutrition-migrate.mts
 *
 * Attribution: Livsmedelsverkets Livsmedelsdatabas (+ USDA FoodData Central for gaps).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const workerDir = path.join(root, 'worker');

const nutritionUrl = pathToFileURL(path.join(workerDir, 'src/nutrition/index.ts')).href;
const {
  catalogFromSeed,
  resolveAndApplyRecipe,
} = await import(nutritionUrl);

const seed = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/nutrition-seed.json'), 'utf8')
);

function sqlEscape(s: string): string {
  return String(s).replace(/'/g, "''");
}

function buildSeedSql(): string {
  const lines: string[] = [
    'DELETE FROM recipe_ingredients;',
    'DELETE FROM ingredient_aliases;',
    'DELETE FROM ingredients;',
  ];
  for (const ing of seed.ingredients) {
    lines.push(
      `INSERT INTO ingredients (id, canonical_name, category, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, piece_weight_g, density_g_per_ml, needs_review, piece_weight_source) VALUES (${
        ing.id
      }, '${sqlEscape(ing.canonical_name)}', ${
        ing.category == null ? 'NULL' : `'${sqlEscape(ing.category)}'`
      }, ${ing.kcal_per_100g}, ${ing.protein_per_100g}, ${ing.fat_per_100g}, ${ing.carbs_per_100g}, ${
        ing.piece_weight_g == null ? 'NULL' : ing.piece_weight_g
      }, ${ing.density_g_per_ml == null ? 'NULL' : ing.density_g_per_ml}, ${ing.needs_review || 0}, ${
        ing.piece_weight_source == null
          ? 'NULL'
          : `'${sqlEscape(String(ing.piece_weight_source))}'`
      });`
    );
    const aliases = new Set<string>([
      String(ing.canonical_name).toLowerCase().trim(),
      ...(ing.aliases || []).map((a: string) => String(a).toLowerCase().trim()),
    ]);
    for (const a of aliases) {
      if (!a) continue;
      lines.push(
        `INSERT OR IGNORE INTO ingredient_aliases (ingredient_id, alias) VALUES (${ing.id}, '${sqlEscape(a)}');`
      );
    }
  }
  return lines.join('\n');
}

function wrangler(...args: string[]) {
  console.log('>', 'npx wrangler', ...args);
  execSync('npx wrangler ' + args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '), {
    cwd: workerDir,
    stdio: 'inherit',
    env: process.env,
    shell: '/bin/zsh',
  });
}

console.log('=== Nutrition sharp migrate ===');
wrangler('d1', 'migrations', 'apply', 'receptbok-db', '--remote');

const seedSqlPath = path.join(root, 'scripts/nutrition-seed.sql');
fs.writeFileSync(seedSqlPath, buildSeedSql());
console.log('Wrote', seedSqlPath);
wrangler('d1', 'execute', 'receptbok-db', '--remote', `--file=${seedSqlPath}`);

// Fetch recipes via API or local list from D1 export
const res = await fetch('https://receptbok.receptbok.workers.dev/api/recipes', {
  headers: { Accept: 'application/json', 'User-Agent': 'nutrition-migrate' },
});
if (!res.ok) throw new Error(`Failed to list recipes: ${res.status}`);
const data = await res.json();
const recipes = data.recipes || [];
const catalog = catalogFromSeed(seed.ingredients);

const updates: string[] = ['DELETE FROM recipe_ingredients;'];
const report: {
  id: string;
  oldMacros: unknown;
  newMacros: unknown;
  unmatched: number;
  needsPiece: number;
}[] = [];

for (const recipe of recipes) {
  const { recipe: resolved, resolution } = resolveAndApplyRecipe(catalog, recipe);
  const id = String(resolved.id);
  updates.push(
    `UPDATE recipes SET data = '${sqlEscape(JSON.stringify(resolved))}', updated_at = datetime('now') WHERE id = '${sqlEscape(id)}';`
  );
  for (const row of resolution.rows) {
    updates.push(
      `INSERT INTO recipe_ingredients (
        recipe_id, raw_text, quantity, unit, ingredient_id,
        resolved_grams, kcal, protein, fat, carbs, match_status,
        group_index, ingredient_index
      ) VALUES (
        '${sqlEscape(id)}',
        '${sqlEscape(row.raw_text)}',
        ${row.quantity == null ? 'NULL' : row.quantity},
        ${row.unit == null ? 'NULL' : `'${sqlEscape(row.unit)}'`},
        ${row.ingredient_id == null ? 'NULL' : row.ingredient_id},
        ${row.resolved_grams == null ? 'NULL' : row.resolved_grams},
        ${row.kcal == null ? 'NULL' : row.kcal},
        ${row.protein == null ? 'NULL' : row.protein},
        ${row.fat == null ? 'NULL' : row.fat},
        ${row.carbs == null ? 'NULL' : row.carbs},
        '${sqlEscape(row.match_status)}',
        ${row.group_index},
        ${row.ingredient_index}
      );`
    );
  }
  report.push({
    id,
    oldMacros: recipe.macros,
    newMacros: resolved.macros,
    unmatched: resolution.unmatchedCount,
    needsPiece: resolution.needsPieceWeightCount,
  });
}

const migrateSqlPath = path.join(root, 'scripts/nutrition-migrate-data.sql');
// D1 execute has statement limits — chunk
const CHUNK = 80;
const chunks: string[][] = [];
for (let i = 0; i < updates.length; i += CHUNK) {
  chunks.push(updates.slice(i, i + CHUNK));
}

console.log(`Recipes: ${recipes.length}; SQL stmts: ${updates.length}; chunks: ${chunks.length}`);

for (let i = 0; i < chunks.length; i++) {
  const chunkPath = path.join(root, `scripts/.nutrition-migrate-chunk-${i}.sql`);
  fs.writeFileSync(chunkPath, chunks[i].join('\n'));
  wrangler('d1', 'execute', 'receptbok-db', '--remote', `--file=${chunkPath}`);
  fs.unlinkSync(chunkPath);
}

const reportPath = path.join(root, 'scripts/nutrition-migrate.report.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      migratedAt: new Date().toISOString(),
      recipes: report.length,
      report,
    },
    null,
    2
  )
);
console.log('Wrote', reportPath);
console.log('DONE — deploy worker so create/update/recalc use new nutrition module.');
