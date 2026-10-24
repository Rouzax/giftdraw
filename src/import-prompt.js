// The request an organiser pastes into an AI chat assistant, which then asks
// them for the event step by step and writes the event file. The same text
// is in docs/guide/import.md; a test keeps the two equal.
const PROMPTS = {
  nl: `Je gaat me helpen een bestand te maken voor de app Lootjes trekken (Gift Draw). Ik ben niet technisch, dus houd het eenvoudig en vriendelijk.

Werkwijze:
1. Stel me steeds één vraag tegelijk, in gewone taal, en wacht op mijn antwoord. Begin meteen met de eerste vraag.
2. Vraag in deze volgorde:
   - Hoe het evenement heet, bijvoorbeeld "Kerst 2026".
   - Hoeveel groepen er zijn, bijvoorbeeld één per les. Vraag daarna per groep: de naam, de datum waarop de cadeautjes worden geruild, en of ik een tijd en een plaats wil noemen (dat hoeft niet).
   - Per groep: wie er meedoen. Zeg erbij dat ik de namen onder elkaar mag plakken of typen, met een e-mailadres erachter als ik dat wil. E-mailadressen zijn niet nodig; ik kan ze later ook in de app toevoegen.
   - Of ik een eigen tekst voor de deelnemers wil, of de standaardtekst van de app. De standaardtekst is prima.
3. Is iets niet duidelijk, zoals een datum zonder jaartal, vraag het dan. Verzin nooit namen, datums of e-mailadressen. Weet je de datum van vandaag niet zeker, vraag die dan.
4. Zet daarna alles in een korte samenvatting in gewone woorden, zonder code, en vraag of het klopt.
5. Pas als ik zeg dat het klopt, geef je het bestand: alleen de JSON, in één codeblok. Zeg erbij: "Kopieer alles in het blok en plak het in Lootjes trekken bij Evenement importeren uit een bestand."

Regels voor het bestand (die hoef je mij niet uit te leggen):
- Bovenaan staan precies drie velden: "version": 1, "event" en "groups".
- "event" heeft "name" (hoogstens 100 tekens) en "language": "nl". Alleen als ik een eigen tekst wil: "theme" (hoogstens 2000 tekens).
- "groups" is een lijst met per groep "name", "exchangeDate" (JJJJ-MM-DD, niet in het verleden) en "participants". Alleen als ik ze noem: "exchangeTime" (UU:MM, 24 uur) en "exchangePlace" (één regel).
- "participants" is een lijst met per persoon de naam als tekst, of {"name": "...", "email": "..."} als ik een e-mailadres geef. Geef twee mensen in één groep nooit precies dezelfde naam; vraag me dan hoe ik ze uit elkaar houd.
- Gebruik de veldnamen precies zoals hier geschreven, en geen andere. De volledige beschrijving staat op https://rouzax.github.io/giftdraw/import/event.schema.json`,
  en: `You are going to help me make a file for the app Gift Draw (Lootjes trekken). I am not technical, so keep it simple and friendly.

How to work:
1. Ask me one question at a time, in plain words, and wait for my answer. Start with the first question straight away.
2. Ask in this order:
   - What the event is called, for example "Christmas 2026".
   - How many groups there are, for example one per class. Then, per group: its name, the date the presents are exchanged, and whether I want to give a time and a place (I do not have to).
   - Per group: who takes part. Tell me I can paste or type the names one below the other, with an email address after a name if I like. Email addresses are not needed; I can also add them later in the app.
   - Whether I want my own text for the participants, or the app's standard text. The standard text is fine.
3. If something is unclear, such as a date without a year, ask. Never make up names, dates or email addresses. If you are not sure of today's date, ask me.
4. Then put everything in a short summary in plain words, without code, and ask whether it is right.
5. Only when I say it is right, give me the file: only the JSON, in one code block. Add: "Copy everything in the block and paste it into Gift Draw under Import an event from a file."

Rules for the file (no need to explain them to me):
- At the top there are exactly three fields: "version": 1, "event" and "groups".
- "event" has "name" (at most 100 characters) and "language": "en". Only if I want my own text: "theme" (at most 2000 characters).
- "groups" is a list with, per group, "name", "exchangeDate" (YYYY-MM-DD, not in the past) and "participants". Only if I mention them: "exchangeTime" (HH:MM, 24-hour) and "exchangePlace" (one line).
- "participants" is a list with, per person, the name as text, or {"name": "...", "email": "..."} if I give an email address. Never give two people in one group exactly the same name; ask me how I tell them apart.
- Use the field names exactly as written here, and no others. The full description is at https://rouzax.github.io/giftdraw/import/event.schema.json`,
};

export function assistantPrompt(lang) {
  return PROMPTS[lang] ?? PROMPTS.nl;
}
