/**
 * Regenerate proteinVariants for all recipes via live Worker.
 * GET /protein-variants creates when missing (public). Pass --force + ADMIN_PASSWORD to overwrite.
 *
 *   npx tsx scripts/regen-protein-variants.mts
 *   ADMIN_PASSWORD='…' npx tsx scripts/regen-protein-variants.mts --force
 */
const API = 'https://receptbok.receptbok.workers.dev';
const force = process.argv.includes('--force');

async function main() {
  let cookie = '';
  if (force) {
    const pw = process.env.ADMIN_PASSWORD || process.env.AUTH_PASSWORD || '';
    if (!pw) {
      console.error('ADMIN_PASSWORD required with --force');
      process.exit(1);
    }
    const login = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!login.ok) {
      console.error('Login failed', await login.text());
      process.exit(1);
    }
    const setCookie = login.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0] || '';
  }

  const listRes = await fetch(`${API}/api/recipes`);
  const payload = (await listRes.json()) as { recipes?: { id: string; title?: string }[] };
  const recipes = payload.recipes || [];
  console.log(`Recipes: ${recipes.length} (force=${force})`);

  for (const r of recipes) {
    process.stdout.write(`→ ${r.id} … `);
    const url = `${API}/api/recipes/${encodeURIComponent(r.id)}/protein-variants`;
    const res = await fetch(url, {
      method: force ? 'POST' : 'GET',
      headers: cookie ? { Cookie: cookie } : {},
    });
    const data = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      cached?: boolean;
      proteinVariants?: unknown[];
      error?: string;
    };
    if (!res.ok) {
      console.log('FAIL', data.error || res.status);
      continue;
    }
    if (data.skipped) console.log('skipped (plant)');
    else if (data.cached) console.log(`cached ${(data.proteinVariants || []).length}`);
    else console.log(`${(data.proteinVariants || []).length} variants`);
  }
}

await main();
