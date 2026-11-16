# Deploy: GitHub Pages (claude-apps)

Detta repo är **redan kopplat** till:

| | |
|---|---|
| **Repo** | https://github.com/johnscottguggenheimer/claude-apps |
| **Receptappen (efter Pages är på)** | https://johnscottguggenheimer.github.io/claude-apps/recept/ |
| **Remote** | `origin` → `git@github.com-johnscott:johnscottguggenheimer/claude-apps.git` |

Du behöver **ingen** separat build eller GitHub Actions för receptappen — det är statisk HTML/CSS/JS under `recept/`.

---

## 1. Aktivera GitHub Pages (engång)

1. Logga in på GitHub som kontot som äger repot (**johnscottguggenheimer**).
2. Öppna repot **claude-apps** → **Settings** → **Pages** (vänstermeny).
3. Under **Build and deployment**:
   - **Source:** *Deploy from a branch*.
   - **Branch:** `main`, mapp **/** (root). Spara.
4. Efter någon minut ska sajten finnas på  
   `https://johnscottguggenheimer.github.io/claude-apps/`  
   och receptappen på  
   `https://johnscottguggenheimer.github.io/claude-apps/recept/`.

Om du ser **404** första gången: vänta 1–5 minuter och ladda om. Kontrollera att `main` är den branch du pushar till.

---

## 2. Publicera ändringar (varje gång)

Från den här klonen:

```bash
git add recept/index.html CLAUDE.md   # eller vad du ändrat
git commit -m "Beskriv vad som ändrats"
git push origin main
```

GitHub Pages bygger om automatiskt efter push (ofta inom ~1 minut).

---

## 3. Förhandsgranska lokalt

Från mappen `recept/`:

```bash
./serve.sh
```

Öppna **http://127.0.0.1:8765/** i webbläsaren.

Nya recept läggs in i `recept/recipes.js` (arrayen `RECIPES`) via Cursor — inte i appen. Varje recept ska ha fältet **`category`**: `middag`, `asiatisk`, `sallad`, eller `bakning`, samt **`baseServings`**.

Validera före push:

```bash
node scripts/validate-recipes.mjs
```

---

## 4. Annat GitHub-konto i Cursor / andra projekt

På samma dator kan du ha **jobb-konto** och **johnscottguggenheimer** sida vid sida. Viktigaste är att **push till detta repo** använder rätt inloggning.

### A) HTTPS (som nu)

Remote ser ut ungefär så här:

`https://johnscottguggenheimer@github.com/johnscottguggenheimer/claude-apps.git`

Vid `git push` frågar Git efter **lösenord** — för GitHub ska det vara en **Personal Access Token (PAT)** med `repo`, inte kontots lösenord.

- Skapa PAT: GitHub → **Settings** → **Developer settings** → **Personal access tokens** (klassisk eller fine-grained med åtkomst till repot **claude-apps**).
- macOS lagrar ofta i **Nyckelhanteraren** per URL/användarnamn så nästa projekt med annat konto inte skriver över om host/användarnam skiljer sig.

Om push till **fel konto** eller **403**:

```bash
cd /path/to/claude-apps   # denna klon
git remote -v
```

Bekräfta att URL:n pekar på **johnscottguggenheimer/claude-apps**. Uppdatera vid behov:

```bash
git remote set-url origin https://github.com/johnscottguggenheimer/claude-apps.git
```

Vid första push till denna URL loggar du in med **johnscottguggenheimer** + PAT.

### B) SSH med separat nyckel per konto (rekommenderat vid flera konton)

1. Skapa en dedikerad nyckel (exempel):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_johnscott -C "github johnscottguggenheimer"
   ```

2. Lägg in **public key** på GitHub: **johnscottguggenheimer** → **Settings** → **SSH and GPG keys**.

3. I `~/.ssh/config`:

   ```
   Host github.com-johnscott
       HostName github.com
       User git
       IdentityFile ~/.ssh/id_ed25519_johnscott
       IdentitiesOnly yes
   ```

4. Byt remote i **detta** repo till SSH via alias:

   ```bash
   git remote set-url origin git@github.com-johnscott:johnscottguggenheimer/claude-apps.git
   ```

5. Testa:

   ```bash
   ssh -T git@github.com-johnscott
   ```

   Du ska se ett välkomstmeddelande för **johnscottguggenheimer**.

Andra projekt kan använda standard `github.com` med en annan `IdentityFile` — då väljer SSH rätt nyckel per **Host**-alias.

---

## 5. Commit-identitet i bara detta repo

Repot har redan lokalt (bra för att inte blanda med jobb-mail):

```bash
git config user.name
git config user.email
```

Vill du ändra **endast här**:

```bash
cd /path/to/this/repo
git config user.name "Ditt visningsnamn"
git config user.email "din-mail-som-på-github"
```

(`git config` utan `--global` gäller bara denna klon.)

---

## 6. Snabb felsökning

| Problem | Åtgärd |
|--------|--------|
| 404 på Pages | Vänta några minuter; kontrollera **Settings → Pages** att branch är `main` och root `/`. |
| Push nekas | Kontrollera PAT/SSH och att du är inloggad som **rätt** GitHub-användare för detta repo. |
| Fel sajt öppnas | Öppna exakt `…/claude-apps/recept/` — appen ligger under undermappen **recept**. |

---

Sammanfattning: **aktivera Pages en gång** på GitHub, sedan räcker **`git push origin main`** från denna klon när du är autentiserad som **johnscottguggenheimer**.
