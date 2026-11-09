# site-visit-counter

Loendab kodulehe külastusi ilma küpsisteta, sinu enda Cloudflare'i kontol. Näed, millised lehed avati, kust inimesed tulid, millise lingi kaudu (?src=), mis seadmest, kui kaua leht ekraanil oli, mitu korda klõpsati telefoninumbril ja e-posti aadressil, kas vormi hakati täitma ja kas see saadeti, kui suur osa videost vaadati ja millised lehed puudusid (404).

IP-aadressi ei salvestata ja külastaja brauserisse ei panda midagi. Väliseid teenuseid ei ole: lehe skript saadab märkmed sinu enda aadressile ja andmed jäävad sinu Cloudflare D1 andmebaasi (soovi korral ainult Euroopa Liidus). Sõltuvusi pole.

Sama lahendus loendab külastusi aadressil [novu.ee](https://novu.ee).

*English below.*

## Mida see loendab

- **Lehe avamine:** aadress, eelmise lehe domeen (google.com, facebook.com), lingi silt (`?src=`, `utm_source` või `ref`), telefon, tahvel või arvuti, riik ja kas lehte ei leitud (404).
- **Aeg lehel:** mitu sekundit leht päriselt ekraanil oli (taustal olev vahekaart ei loe), kõige rohkem 30 minutit.
- **Klõpsud** `tel:` ja `mailto:` linkidel, ise.
- **Vormid**, millel on `data-count`: täitmist alustati ja vorm saadeti.
- **Videod**, millel on `data-count`: video loetakse vaadatuks, kui see on 3 sekundit mänginud, ja kirja läheb, kui suur osa sellest vaadati.
- **Oma sündmused:** `visitCounter.count('broneering', 'saun')`.

## Kuidas privaatsus on hoitud

- IP-aadressi ei salvestata. Sama päeva külastuste kokku lugemiseks tehakse IP-aadressist, brauseri nimest ja päeva juhuslikust võtmest ühesuunaline kood (SHA-256). Võti tehakse päeva esimesel külastusel ja eelmise päeva võti kustutatakse samal hetkel, nii et koodi ei saa siduda aadressiga ega sama inimese teiste päevade külastustega.
- Küpsiseid ega muud brauserisse salvestamist ei kasutata. Ainus erand: kui keegi avab ise lingi `?notrack=1`, jätab brauser meelde, et teda ei loetaks.
- Kui brauser saadab „ära jälgi“ signaali (Do Not Track või Global Privacy Control), külastust ei loeta. Robotid ja otsingumootorid ei lähe arvesse.
- Üksikud kirjed kustuvad `KEEP_DAYS` (vaikimisi 30) päeva pärast, alles jäävad ainult päevased koondnumbrid.
- Märkmeid võtab vastu ainult sinu enda lehelt (`ALLOWED_ORIGINS`), üks IP saab saata kuni 60 märget minutis ja sündmusi saab lisada ainult sama inimene, kes lehe avas. Nii ei saa keegi su numbreid võltsitud külastustega rikkuda.
- Vaade on kaitstud võtmega (`STATS_TOKEN`), mida võrreldakse konstantse ajaga.

Kas sinu lehel tuleb sellegipoolest nõusolekut küsida, sõltub sinu riigi reeglitest. Allpool on privaatsusteksti näidis, mille saad oma privaatsuspoliitikasse panna.

## Seadistamine

Vaja on Cloudflare'i kontot (tasuta pakett sobib) ja Node 18+. Kõige parem on, kui sinu lehe domeen on samas Cloudflare'i kontos: siis tulevad märkmed sinu enda aadressile (`firma.ee/visits/…`) ja reklaamiblokeerijad neid ei puuduta.

1. Laadi kood alla ja logi Cloudflare'i sisse:

   ```bash
   git clone https://github.com/novuwebsolutions/site-visit-counter.git
   cd site-visit-counter
   npx wrangler login
   ```

2. Tee andmebaas (`--jurisdiction eu` hoiab andmed ainult Euroopa Liidus):

   ```bash
   npx wrangler d1 create site-visits --jurisdiction eu
   ```

3. Tee seadetest oma koopia ja kirjuta sinna andmebaasi id (eelmise käsu vastusest), oma domeen ja ajavöönd:

   ```bash
   cp wrangler.example.jsonc wrangler.jsonc
   ```

   Muuda `wrangler.jsonc` failis: `database_id`, `routes` (`firma.ee/visits/*` ja `zone_name`), `ALLOWED_ORIGINS` (`https://firma.ee,https://www.firma.ee`) ja vajadusel `TIME_ZONE`.

4. Pane vaate võti. Mõtle välja pikk juhuslik võti (näiteks käsuga `openssl rand -hex 24`) ja hoia see alles:

   ```bash
   npx wrangler secret put STATS_TOKEN
   ```

5. Pane Worker üles:

   ```bash
   npx wrangler deploy
   ```

6. Lisa oma lehe igale lehele, enne `</body>` või `<head>`-i:

   ```html
   <script src="/visits/counter.js" defer></script>
   ```

   404-lehel lisa sellele `data-missing`:

   ```html
   <script src="/visits/counter.js" data-missing defer></script>
   ```

7. Ava vaade aadressil `https://firma.ee/visits/` ja sisesta võti. Võti jääb ainult sinu brauserisse.

8. Et oma külastusi mitte lugeda, ava igas oma seadmes kord `https://firma.ee/?notrack=1`. Tagasi: `?notrack=0`.

Esimesel külastusel teeb Worker tabelid ise. Igal ööl kell 03:17 UTC liidab ta vanemad kui `KEEP_DAYS` päeva külastused päevasteks numbriteks ja kustutab üksikud kirjed.

### Vormid, videod ja oma sündmused

```html
<form data-count="kontakt">…</form>
<video data-count="Tutvustus" src="tutvustus.mp4" controls></video>
```

Vormi `submit` loetakse saatmiseks. Kui vorm saadetakse JavaScriptiga ja tahad lugeda ainult õnnestunud saatmisi, kutsu pärast õnnestumist:

```js
visitCounter.count('form_sent', 'kontakt');
```

Oma sündmus (tüüp on väikesed tähed, numbrid ja `_`, kuni 32 märki; nimi kuni 80 märki), iga tüüp ja nimi loetakse lehevaatamise kohta üks kord:

```js
visitCounter.count('broneering', 'saun');
visitCounter.watch(document.querySelector('video'), 'Tutvustus');
```

### Kui leht ei ole Cloudflare'is

Kustuta `wrangler.jsonc` failist `routes`, pane `"workers_dev": true` ja lisa oma lehe aadress `ALLOWED_ORIGINS` alla. Skript tuleb siis Workeri aadressilt:

```html
<script src="https://site-visit-counter.SINU-NIMI.workers.dev/visits/counter.js" defer></script>
```

### Content-Security-Policy

Kui sinu lehel on CSP, peavad `script-src` ja `connect-src` lubama loendurit. Samal domeenil piisab `'self'`-ist, workers.dev aadressi puhul lisa see aadress mõlemasse.

### Tasuta paketi piirid

Üks lehevaatamine on tavaliselt 2–3 päringut Workerile ja sama palju kirjutusi andmebaasi. Cloudflare'i tasuta paketis on 100 000 Workeri päringut ja 100 000 D1 kirjutust päevas, nii et sellest jagub umbes 30 000 lehevaatamiseks päevas.

## Privaatsusteksti näidis

Kohanda oma lehe järgi (asenda e-posti aadress ja vajadusel see, mida loendad):

> **Küpsisteta külastusstatistika**
>
> Et näha, mis lehel töötab, loendame külastusi ise, ilma küpsiste ja väliste teenusteta. Iga avatud lehe kohta salvestame: lehe aadressi ja selle, kas lehte ei leitud (404); kust tulite (eelmise lehe domeen ja lingi silt, kui aadressis on ?src=, utm_source või ref); seadme tüübi (telefon, tahvel või arvuti) ja riigi; kui kaua oli leht ekraanil; kas avasite video ja kui suure osa sellest vaatasite; kas klõpsasite telefoninumbril või e-posti aadressil ning kas alustasite vormi täitmist ja saatsite selle. Vormi sisu siia ei jõua.
>
> IP-aadressi ei salvestata. Et sama päeva külastusi kokku lugeda, tehakse IP-aadressist, brauseri tüübist ja päeva salajasest võtmest ühesuunaline kood, mida ei saa tagasi IP-aadressiks muuta. Võti vahetub iga päev ja eelmise päeva võti kustutatakse. Teie brauserisse ei salvestata selleks midagi. Kui teie brauser saadab „ära jälgi“ signaali (Do Not Track või Global Privacy Control), teie külastust ei loeta. Lingiga ?notrack=1 jätab teie brauser meelde, et teie külastusi ei loetaks.
>
> Üksikud kirjed kustuvad 30 päeva pärast, alles jäävad ainult päevased koondnumbrid. Andmed on Cloudflare'i andmebaasis Euroopa Liidus. Alus on meie õigustatud huvi mõista, kuidas lehte kasutatakse. Võite sellele vastu vaielda, kirjutades info@firma.ee.

## Ainult teegina

Oma Workeris saad kasutada ainult serveri osa:

```js
import { record, stats, fold } from 'site-visit-counter';

await record(request, env);          // POST märge lehelt (env.DB, env.ALLOWED_ORIGINS, env.HIT_LIMIT, env.TIME_ZONE)
const numbers = await stats(env, 30); // { days, from, perDay, lists }
await fold(env, 30);                  // öine koondamine
```

## Testid

```bash
npm test
```

Testid kasutavad Node'i sisseehitatud SQLite'i (Node 22.13+) päris SQL-iga, võrku ei kasutata.

## English

Counts your website's visits without cookies, on your own Cloudflare account: pages opened, the site visitors came from, the link tag (`?src=`, `utm_source` or `ref`), phone / tablet / computer, country, seconds the page was really on screen, clicks on `tel:` and `mailto:` links, forms and videos marked `data-count` (a video counts after 3 seconds of playing, with how much of it was watched), missing pages (404) and your own events (`visitCounter.count('booking', 'sauna')`). No dependencies, no outside service.

**Privacy.** No IP address is stored. Within one day, visitors are told apart by a SHA-256 code of the IP address, the browser's name and a random key for that day; the key is made on the day's first visit and the previous day's key is deleted at the same moment, so a code cannot be traced back to an address nor linked to the same person on another day. Nothing is stored in the visitor's browser (except a `?notrack=1` opt-out the visitor asks for). Do Not Track, Global Privacy Control and bots are not counted. Single records are deleted after `KEEP_DAYS` (30) days and only daily totals remain. Notes are taken only from your own site (`ALLOWED_ORIGINS`), at most 60 a minute per IP, and only the person who opened a page can add events to it, so nobody can spoil your numbers with made-up visits. The dashboard is behind a key (`STATS_TOKEN`) compared in constant time. Whether your site still needs to ask for consent depends on your country's rules; the Estonian privacy text above shows what to tell visitors.

**Setup.**

```bash
git clone https://github.com/novuwebsolutions/site-visit-counter.git
cd site-visit-counter
npx wrangler login
npx wrangler d1 create site-visits --jurisdiction eu
cp wrangler.example.jsonc wrangler.jsonc   # paste the database id, your route, ALLOWED_ORIGINS, TIME_ZONE
npx wrangler secret put STATS_TOKEN        # a long random key, e.g. from: openssl rand -hex 24
npx wrangler deploy
```

Then add `<script src="/visits/counter.js" defer></script>` to every page (with `data-missing` on the 404 page), open `https://example.com/visits/` and enter the key. Open `https://example.com/?notrack=1` once on each of your own devices to keep your visits out. The Worker creates its tables on the first visit and folds old visits into daily totals every night. Without your domain on Cloudflare, remove `routes`, set `"workers_dev": true`, list your site in `ALLOWED_ORIGINS` and load the script from the workers.dev address. If your site has a Content-Security-Policy, `script-src` and `connect-src` must allow the counter (`'self'` on the same domain). On Cloudflare's free plan (100,000 Worker requests and 100,000 D1 writes a day) it handles roughly 30,000 page views a day. `record`, `stats` and `fold` can also be imported into your own Worker. Tests run offline against Node's built-in SQLite: `npm test`.

Made by [Novu Web Solutions](https://novu.ee), a web studio in Viljandi, Estonia. More free tools at [novu.ee/tooriistad](https://novu.ee/tooriistad/). MIT licence.
