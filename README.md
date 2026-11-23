# Vaasan Eläinsuoja ry – verkkosovellus

Eläinsuojan esimerkkisivusto, jossa käyttäjä voi tutustua eläimiin ja lähettää adoptiohakemuksen.

## Arkkitehtuuri

Sovellus koostuu kolmesta Docker-palvelusta:

- **Server A (animals, portti 3000):** tarjoilee verkkosivun ja eläimiin liittyvän REST API:n. Se välittää adoptiohakemukset Server B:lle.
- **Server B (adoptions, portti 3001):** vastaanottaa adoptiohakemukset, tarkistaa tiedot ja tallentaa hakemukset PostgreSQL-tietokantaan. Portti 3001 on Docker-verkon sisäinen.
- **PostgreSQL (portti 5432 Docker-verkossa):** tallentaa eläimet ja adoptiohakemukset. `init.sql` luo taulut ja lisää esimerkkieläimet automaattisesti tietokannan ensimmäisellä käynnistyskerralla.

Adoption kulku: selain → Server A → Server B → PostgreSQL → vastaus Server A:n kautta selaimelle.

## Käynnistäminen

Tarvitset Dockerin ja Docker Composen.

```bash
docker-compose up --build
```

Avaa selaimessa:

- Verkkosivu: http://localhost:3000
- Henkilökunnan hakemussivu: http://localhost:3000/admin

Admin-sivun salasana kehitysympäristössä: `shelter-admin`.

Pysäytä palvelut komennolla:

```bash
docker-compose down
```

Tietokannan pysyvä Docker-volume säilyttää tiedot. Jos haluat poistaa myös tietokantaan tallennetut tiedot ja luoda esimerkkitietokannan uudelleen, käytä komentoa `docker-compose down -v`. **Huom:** tämä poistaa tallennetut adoptiohakemukset ja muut tietokantatiedot.

## REST API – Server A

| Menetelmä | Osoite | Kuvaus |
|---|---|---|
| GET | `/animals` | Hakee kaikki eläimet |
| GET | `/animals/:id` | Hakee yhden eläimen tunnisteella |
| POST | `/animals/:id/adopt` | Lähettää adoptiohakemuksen Server B:lle |

Esimerkki POST-pyynnön JSON-rungosta:

```json
{
  "fullName": "Matti Meikäläinen",
  "email": "matti@example.com",
  "phone": "040 123 4567",
  "message": "Meillä on rauhallinen koti."
}
```

## REST API – Server B

| Menetelmä | Osoite | Kuvaus |
|---|---|---|
| POST | `/adoptions` | Vastaanottaa ja tallentaa adoptiohakemuksen |
| GET | `/adoptions` | Palauttaa hakemukset henkilökunnalle (Basic Auth) |

Server A kutsuu Server B:n osoitetta `http://server-b:3001/adoptions` Dockerin sisäisessä verkossa. Selain ei kutsu Server B:tä suoraan.

## Tietokanta ja samanaikaiset hakemukset

Tietokannassa on `animals`- ja `adoptions`-taulut. `adoptions.animal_id` on yksilöllinen ja viittaa eläimeen. Server B käyttää tietokantatransaktiota ja `SELECT ... FOR UPDATE` -rivilukitusta ennen hakemuksen tallentamista. Näin kaksi samanaikaista pyyntöä eivät voi onnistua saman eläimen kohdalla. Eläimen tila päivitetään `adopted`-tilaan samassa transaktiossa.

## Teknologiat

- HTML, CSS ja JavaScript käyttöliittymässä
- Node.js ja HTTP REST API palvelimissa
- PostgreSQL tietokantana
- Docker ja Docker Compose palveluiden käynnistämiseen
