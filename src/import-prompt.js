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
   - Wat ik van de deelnemers wil weten, zodat wie een cadeautje voor iemand zoekt op een idee komt. Laat me de vijf vragen zien die de app gewoonlijk stelt (hieronder bij de regels) en vraag of ik die zo wil houden, of ik er een wil weglaten of anders wil zeggen, en of ik er een vraag bij wil.
   - Per vraag die ik erbij wil: hoe de vraag luidt, en of de deelnemers zelf iets typen of iets aanvinken uit een lijstje. Bij een lijstje: welke keuzes erin staan, en of er bij een keuze nog een vraag moet komen als die is aangevinkt, zoals "Welke soort?".
3. Is iets niet duidelijk, zoals een datum zonder jaartal, vraag het dan. Verzin nooit namen, datums, e-mailadressen, vragen of keuzes. Weet je de datum van vandaag niet zeker, vraag die dan.
4. Zet daarna alles in een korte samenvatting in gewone woorden, zonder code, en vraag of het klopt.
5. Pas als ik zeg dat het klopt, geef je het bestand: alleen de JSON, in één codeblok. Zeg erbij: "Kopieer alles in het blok en plak het in Lootjes trekken bij Evenement importeren uit een bestand."

Regels voor het bestand (die hoef je mij niet uit te leggen):
- Bovenaan staan precies drie velden: "version": 2, "event" en "groups".
- "event" heeft "name" (hoogstens 100 tekens) en "language": "nl". Alleen als ik een eigen tekst wil: "theme" (hoogstens 2000 tekens).
- De vijf gewone vragen, met hun "id" en "type":
  - "hobbies", "text": Hobby's en interesses.
  - "likes", "choices": Ik houd van..., om aan te vinken: "Chocolade?" (vraagt dan "Welke smaak?"), "Thee", "Koffie", "Bad- of doucheproducten", "Kaarsen", "Boeken of puzzels", "Planten of bloemen", "Wijn".
  - "pets", "choices": Huisdieren, om aan te vinken: "Hond", "Kat", "Ander dier?" (vraagt dan "Welk dier?").
  - "avoid", "text": Liever niet, of allergieën.
  - "other", "text": Verder nog iets?
- Wil ik de vijf gewone vragen zo houden, zonder vragen erbij, laat "questions" dan weg. Anders heeft "event" een lijst "questions" met alle vragen van het formulier, in de volgorde waarin deelnemers ze zien. Een gewone vraag die ik houd, staat er dus ook in; een die ik weglaat, niet.
- Een gewone vraag schrijf je als {"id": "hobbies", "type": "text"}. Alleen als ik hem anders wil zeggen: "text" met mijn woorden. Alleen als ik de keuzes bij "likes" of "pets" verander: "choices" met de hele nieuwe lijst, met de gewone keuzes precies zoals hierboven geschreven.
- Een eigen vraag heeft geen "id": {"type": "text", "text": "..."} als de deelnemers zelf iets typen, of {"type": "choices", "text": "...", "choices": ["...", "..."]} voor een lijstje om aan te vinken.
- Een keuze is een tekst, zoals "Kaarsen". Een vraag bij een keuze komt na een vraagteken: "Boeken? Welke schrijver?". Alleen een vraagteken, zoals "Wijn?", vraagt "Iets in het bijzonder?". Staat er een vraagteken in de keuze zelf, schrijf de keuze dan als {"label": "...", "question": "..."}.
- Een vraag, een keuze en een vraag bij een keuze zijn elk hoogstens 80 tekens. Het formulier heeft hoogstens 15 vragen, een lijstje hoogstens 30 keuzes.
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
   - What I want to know from the participants, so that whoever looks for a present for someone gets an idea. Show me the five questions the app usually asks (below, in the rules) and ask whether I want to keep them as they are, leave one out or word one differently, and whether I want to add a question.
   - For each question I add: how it is worded, and whether participants type something themselves or tick things in a list. For a list: which choices are in it, and whether a choice should ask something more once it is ticked, such as "Which kind?".
3. If something is unclear, such as a date without a year, ask. Never make up names, dates, email addresses, questions or choices. If you are not sure of today's date, ask me.
4. Then put everything in a short summary in plain words, without code, and ask whether it is right.
5. Only when I say it is right, give me the file: only the JSON, in one code block. Add: "Copy everything in the block and paste it into Gift Draw under Import an event from a file."

Rules for the file (no need to explain them to me):
- At the top there are exactly three fields: "version": 2, "event" and "groups".
- "event" has "name" (at most 100 characters) and "language": "en". Only if I want my own text: "theme" (at most 2000 characters).
- The five usual questions, with their "id" and "type":
  - "hobbies", "text": Hobbies and interests.
  - "likes", "choices": I like..., to tick: "Chocolate?" (which then asks "Which flavour?"), "Tea", "Coffee", "Bath or shower products", "Candles", "Books or puzzles", "Plants or flowers", "Wine".
  - "pets", "choices": Pets, to tick: "Dog", "Cat", "Other?" (which then asks "Which animal?").
  - "avoid", "text": Rather not, or allergies.
  - "other", "text": Anything else?
- If I keep the five usual questions as they are, with no questions added, leave out "questions". Otherwise "event" has a list "questions" with every question of the form, in the order participants see them. So a usual question I keep is in it too; one I leave out is not.
- Write a usual question as {"id": "hobbies", "type": "text"}. Only if I want it worded differently: "text" with my words. Only if I change the choices of "likes" or "pets": "choices" with the whole new list, with the usual choices written exactly as above.
- A question of my own has no "id": {"type": "text", "text": "..."} when participants type something themselves, or {"type": "choices", "text": "...", "choices": ["...", "..."]} for a list to tick.
- A choice is a text, such as "Candles". A question with a choice comes after a question mark: "Books? Which author?". A question mark alone, such as "Wine?", asks "Anything in particular?". If the choice itself contains a question mark, write it as {"label": "...", "question": "..."}.
- A question, a choice and a question with a choice are each at most 80 characters. The form has at most 15 questions, a list at most 30 choices.
- "groups" is a list with, per group, "name", "exchangeDate" (YYYY-MM-DD, not in the past) and "participants". Only if I mention them: "exchangeTime" (HH:MM, 24-hour) and "exchangePlace" (one line).
- "participants" is a list with, per person, the name as text, or {"name": "...", "email": "..."} if I give an email address. Never give two people in one group exactly the same name; ask me how I tell them apart.
- Use the field names exactly as written here, and no others. The full description is at https://rouzax.github.io/giftdraw/import/event.schema.json`,
};

export function assistantPrompt(lang) {
  return PROMPTS[lang] ?? PROMPTS.nl;
}
