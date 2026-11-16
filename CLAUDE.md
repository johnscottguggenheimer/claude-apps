# Receptapp — projektinstruktion

## Vad projektet är

En receptapp på **Cloudflare Workers** (D1, R2, auth, API) som samlar recept från Instagram och receptsajter. Frontend i `recept/`; backend i `worker/`.

**Live:** https://receptbok.receptbok.workers.dev  
**Repo:** https://github.com/johnscottguggenheimer/claude-apps  
**Fil:** `recept/index.html` (+ `recept/app.js` för logik; data via `/api/recipes`)

**Deploy:** `git push origin main` + `cd worker && npm run deploy`. Se **[DEPLOY.md](./DEPLOY.md)**.

### I Cursor (denna workspace)

Så här använder du samma flöde **här i Cursor** utan separat app:

1. Öppna **`recept/index.html`** i editorn (rekommenderat — då ingår projektregeln **recept-add-from-url**). Om filen inte är öppen: nämn `@CLAUDE.md` eller `@recept-add-from-url` i chatten.
2. Klistra in en **Instagram-post/reel** eller **receptsajt-URL** och skriv t.ex. *Lägg till detta recept* eller *Importera till receptappen*.
3. Agenten hämtar sidan om möjligt (Instagram kan kräva att du klistrar in caption manuellt), bygger ett objekt enligt formatet nedan och infogar det i `RECIPES` i `recept/index.html`.

---

## Hur recept läggs till

1. Användaren skickar en Instagram-URL (eller annan recept-URL)
2. Hämta sidan och extrahera receptet från captionen eller receptsidan
3. Bygg ett receptobjekt i samma format som befintliga recept i `recept/recipes.js`
4. Lägg till objektet i `RECIPES`-arrayen i `recept/recipes.js`
5. **Nytt!-märke:** Lägg receptets `id` först i arrayen `FEATURED_NEW_IDS` i `recept/app.js` så det visas överst med "Nytt!" tills användaren öppnat receptet (sparad i cookie).
6. Kör `node scripts/validate-recipes.mjs` — ska vara OK innan push.
7. `git add recept/ && git commit -m "Add [receptnamn]" && git push` (eller `git add .` om fler filer ska med)
8. GitHub Pages uppdateras automatiskt efter ~30 sekunder

---

## Receptformat

```js
{
  id: 'kebab-case-id',
  category: 'middag', // måltidstyp: frukost | lunch | middag | tillbehor | fika
  baseServings: 4, // portioner som ingredienslistan och macros avser
  tags: ['kyckling'], // proteinkälla + diet — se TAG_FILTER_ORDER i app.js
  image: 'images/recept.png', // valfritt; annars emoji-bakgrund
  emoji: '🍕',
  title: 'Receptnamn', // alltid svenska — översätt engelska källtitlar; aldrig «protein» i namnet
  source: '@kontonamn på Instagram', // ursprunglig skapare — aldrig den som vidarebefordrat receptet
  sourceUrl: 'https://www.instagram.com/p/...',
  badges: ['4 portioner', '30 min', 'hög protein'], // tid alltid «XX min» (inga ca/under/intervall)
  macros: { kcal: 0, prot: 0, carb: 0, fat: 0 }, // hela receptet
  groups: [
    {
      name: 'Sektionsnamn', // Botten, Sås, Toppings, Finish etc.
      ingredients: [
        { name: 'ingrediensnamn (lowercase)', amount: 100, unit: 'g' }
      ]
    }
  ],
  steps: [
    { title: 'Stegnamn', text: 'Beskrivning.' }
  ],
  tips: [
    { title: 'Seattle', text: 'Mild/barnvänlig anpassning för Seattle Mae (7 år).' },
    { title: 'Rubrik', text: '...' },
    { title: 'Rubrik', text: '...' },
    { title: 'Rubrik', text: '...' }
  ]
}
```

**Listvy:** Första raden filtrerar på **kategori** (en i taget). Andra raden är **taggar** — bara taggar som finns på recept visas; flera kan vara valda (alla ska matcha). Taggar = diet/tid/protein, inte redskap (ugn/stekpanna) eller tillbehör (använd kategori). Nya tagg-id i `TAG_FILTER_ORDER` och `TAG_LABELS` i `recept/app.js`.

**Validering:** `node scripts/validate-recipes.mjs` före push. Vid valfritt `macros` per ingrediens jämförs summan mot receptets `macros`.

---

## Måttregler

- Alltid `g`, `msk`, `tsk`, `st` — aldrig gram/tbsp/tsp i fältet `unit`
- Övriga enheter som förekommer i appen: `pinch`, `näve`, `strimlor` m.m.
- Lowercase på alla ingrediensnamn
- Makros gäller hela receptet, inte per portion
- **`title` alltid på svenska** — översätt engelska/internationella källnamn (etablerade matlånord som gochujang, teriyaki, buffalo får stanna)
- **`title` utan «protein»** — använd aldrig protein/högprotein i receptnamn; proteinhalt via badges och makros
- **Ingrediensnamn på naturlig svenska** — inte ord-för-ord. Mejeri med fetthalt som butik: «keso 4%» (inte «fullfet keso»), «keso 1,5%», «grekisk yoghurt 0%». Maskinlägen (Ninja Creami m.fl.) behåll engelskt produktnamn: «"Lite Ice Cream"-läget», «Re-spin» — aldrig «lite glass» / «respinna». **Engelska skafferitermer** (inga kalques): **chocolate chips** (inte chokladchips), **pb2**, **monk fruit**. Övrigt: sojasås → **soja**; cubed → **tärnad** (inte kuberad); persisk gurka → **gurka**; vaniljpasta → **vaniljextrakt**; spicy mayo → **chilimajonnäs**; drizzle → **ringla** (inte dryppla); avocado → **avokado**
- **`source` = ursprunglig skapare** — @handle, blogg/sajt eller kock + publikation. Läs av caption, URL och synlig @handle på skärmdumpar. **Aldrig** vän/familj som vidarebefordrat (t.ex. Antonia) om de inte själva postat receptet. Vid okänd: «Okänd källa»

## Makros

- Beräkna så noggrant som möjligt utifrån ingredienserna
- Leucin och DIAAS är relevanta för proteinkvalitet (vid behov)

---

## Familjen

- **John Scott** — avancerad hemmakock, styrketräning/olympisk lyftning, Malmö
- **Antonia** — CrossFit, fokuserar på protein och återhämtning
- **Seattle Mae** — 7 år, alltid en mild anpassning i tips-sektionen

### Tips-sektionen

- Alltid **4 tips** per recept
- Första tipset är alltid **Seattle** — mild/barnvänlig anpassning
- Övriga tips: variationer, teknik, substitut, förberedelse

---

## Appen — funktioner

- Receptlista med emoji, namn och badges
- Detaljvy per recept med ingredienser grupperade i sektioner
- Serveringskalkyl (+ / −) som skalar alla ingredienser och makros
- Makros visas för hela receptet
- Källa och länk till original
- Tips & variationer med fyra rutor
- Mörkt/ljust läge via CSS

---

## Tekniskt

- Ren HTML/CSS/JS — inga ramverk, inga beroenden
- Data i `recept/recipes.js`, logik i `recept/app.js`, validering i `recept/recipe-validate.js`
- GitHub Pages hostas från `main`-branchen, rot `/`
- **CSP-kompatibel kod:** inga template literals i `innerHTML`; använd DOM-metoder (`createElement`, `textContent`, etc.)
