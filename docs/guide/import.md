# Import an event from a file

Instead of typing an event, its groups and every participant into the forms, you can describe them once in a file and import that. The file is plain text in a fixed format (JSON). You do not have to write it yourself: an AI chat assistant such as ChatGPT, Claude or Gemini can turn your own description into the file, using the request below.

An import does exactly what the forms would do, in one go:

- It always creates a **new** event. It never changes or adds to an event you already have.
- It creates every group with its date, time, place and auto-open date.
- It adds the participants and pairs everyone in each group of 3 or more, the same way pasting a list does. Every participant gets their own link.
- It sends **no mail**. Invitations stay a separate step for each group, as in [Send the invitations](invitations.md).

The file never holds pairs, links or who has drawn, so it cannot be used to restore an event or to open anyone's page.

!!! warning "What you give an AI assistant goes to the company behind it"

    Names and email addresses you type into a chat assistant are sent to that company. If you would rather not share them, let the assistant make the file with names only (or with the groups only), import that, and add the email addresses afterwards on each person's page or by pasting the list into the group. See [Add groups and participants](groups.md).

## Before you start

- You can log in to the organiser pages.
- You know, per group: its name, the exchange date, and if you like the time, the place and the date drawing should open by itself.
- You have the list of people per group. An email address is optional for each person.

## 1. Have the file written

There are two ways to ask the assistant. If you are not sure, take the first.

### Let the assistant ask you

The quickest way is the app's own import page: choose **Import an event from a file** (*Evenement importeren uit een bestand*) on the **Events** (*Evenementen*) page and press **Copy the request** (*Kopieer het verzoek*). It copies the request below in your admin language. Paste it into a new chat and send it as it is: there is nothing to fill in. The assistant then asks you one thing at a time, in plain words: the name of the event, the groups with their dates, and who is in each group. You can paste a list of names when it asks for the people. Email addresses are optional; you can leave them out and add them later in the app.

When it has everything, the assistant shows a short summary in plain words. Check it, say what is wrong or that it is right, and only then does it give you the file.

=== "Nederlands"

    ```text
    Je gaat me helpen een bestand te maken voor de app Lootjes trekken (Gift Draw). Ik ben niet technisch, dus houd het eenvoudig en vriendelijk.

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
    - Gebruik de veldnamen precies zoals hier geschreven, en geen andere. De volledige beschrijving staat op https://rouzax.github.io/giftdraw/import/event.schema.json
    ```

=== "English"

    ```text
    You are going to help me make a file for the app Gift Draw (Lootjes trekken). I am not technical, so keep it simple and friendly.

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
    - Use the field names exactly as written here, and no others. The full description is at https://rouzax.github.io/giftdraw/import/event.schema.json
    ```

### You already have everything written down

If you have the groups and the lists of people ready, this request makes the file in one go. Copy it, replace the last part with your own description, fill in today's date, and send it. Write the description in your own words; a list you already have, such as a class list, is fine. This request can also set the choices under "I like...", which the first one leaves at the standard list.

=== "Nederlands"

    ```text
    Maak een JSON-bestand voor de app Lootjes trekken (Gift Draw). Antwoord alleen met de JSON, in één codeblok.

    Regels:
    - Bovenaan staan precies drie velden: "version": 1, "event" en "groups".
    - "event" heeft "name" (verplicht, hoogstens 100 tekens) en "language": "nl". Alleen als ik erom vraag: "cleanupWeeks" (1 tot en met 52), "theme" (tekst voor de deelnemers, hoogstens 2000 tekens) en "wishOptions" (de keuzes bij "Ik houd van...": een lijst met teksten, of {"label": "...", "question": "..."} voor een keuze met een vraag van hoogstens 80 tekens).
    - "groups" is een lijst met per groep "name", "exchangeDate" (JJJJ-MM-DD) en "participants". Alleen als ik ze noem: "exchangeTime" (UU:MM, 24 uur), "exchangePlace" (één regel) en "autoOpenAt" (JJJJ-MM-DD, niet na de ruildatum).
    - "participants" is een lijst met namen, of {"name": "...", "email": "..."} voor iemand met een e-mailadres. Verzin nooit een e-mailadres. Geef twee mensen in één groep nooit precies dezelfde naam.
    - Geen datum ligt in het verleden. Vandaag is het [datum van vandaag].
    - Gebruik de veldnamen precies zoals hier geschreven, en geen andere. De volledige beschrijving staat op https://rouzax.github.io/giftdraw/import/event.schema.json

    Mijn evenement:
    [Beschrijf hier de naam, en per groep de dag, datum, tijd en plaats van het ruilen en wie erin zitten.]
    ```

=== "English"

    ```text
    Make a JSON file for the app Gift Draw (Lootjes trekken). Reply with only the JSON, in one code block.

    Rules:
    - At the top there are exactly three fields: "version": 1, "event" and "groups".
    - "event" has "name" (required, at most 100 characters) and "language": "en". Only if I ask for them: "cleanupWeeks" (1 to 52), "theme" (text for the participants, at most 2000 characters) and "wishOptions" (the choices under "I like...": a list of texts, or {"label": "...", "question": "..."} for a choice with a question of at most 80 characters).
    - "groups" is a list with, per group, "name", "exchangeDate" (YYYY-MM-DD) and "participants". Only if I mention them: "exchangeTime" (HH:MM, 24-hour), "exchangePlace" (one line) and "autoOpenAt" (YYYY-MM-DD, not after the exchange date).
    - "participants" is a list of names, or {"name": "...", "email": "..."} for someone with an email address. Never make up an email address. Never give two people in one group exactly the same name.
    - No date is in the past. Today is [today's date].
    - Use the field names exactly as written here, and no others. The full description is at https://rouzax.github.io/giftdraw/import/event.schema.json

    My event:
    [Describe the name here, and per group the day, date, time and place of the exchange and who is in it.]
    ```

Fill in today's date: assistants often do not know it, and a date in the past is refused.

### What comes back

The file is a block of text that starts with `{` and ends with `}`. Copy all of it, or save it as a file ending in `.json`. A sentence before or after the block does no harm: the app takes the first code block, or else everything from the first `{` to the last `}`.

The field names in the file stay in English, whatever language you chat in, because the app reads them.

## 2. Check it in the app

1. On the **Events** (*Evenementen*) page, choose **Import an event from a file** (*Evenement importeren uit een bestand*).
2. Under **Paste the file** (*Plak het bestand*), paste the text into **The text of the file** (*De tekst van het bestand*), or press **Choose a file** (*Kies een bestand*) to load a saved file.
3. Press **Check** (*Controleren*).

![The import page: the request for the assistant with its copy button, and below it the file pasted in](../images/organiser-import.webp){ .shot }

Checking creates nothing yet. You get one of two pages.

**This file cannot be imported yet** (*Dit bestand kan nog niet worden geïmporteerd*)
:   A list of everything that has to change, each with its place in the file, such as *Groep 2 (Woensdagavond): De ruildatum ligt in het verleden.* The text is below the list; correct it there, or paste the list into the chat and ask the assistant to fix the file, then check again.

![Three problems listed with the group and participant they belong to](../images/organiser-import-errors.webp){ .shot }

**Check before importing** (*Controleer voor het importeren*)
:   Everything the import will create: the event's settings, each group with its date, place and auto-open date, and the number of participants. Open a group's count to see the names.

![The check page: the event settings, then each group](../images/organiser-import-check.webp){ .shot }

Above that, **Please check** (*Kijk hier even naar*) lists things that are allowed but may not be what you meant:

- an event with the same name already exists, so importing makes a second one;
- a group has fewer than 3 people (pairs are made once it has 3);
- two people in one group have the same name;
- an email address appears twice in a group, or also in another group (a couple sharing one address is fine);
- two groups have the same name;
- a choice under "I like..." or "Pets" appears more than once.

## 3. Import

Press **Yes, create this event** (*Ja, maak dit evenement*). The event opens with the message **The event has been imported** (*Het evenement is geïmporteerd*).

The checks run once more at that moment. If a date has passed since you checked, the import is refused and the problem is listed.

For a day after an import, pressing the button again, also after going back to the check page, takes you to the event that file made instead of making a second one. If you deleted that event in the meantime, the file can be imported anew. The app forgets this when it restarts; a fresh check of the same file then warns that an event with that name already exists.

Then carry on as usual: look over each group, swap pairs if you want ([Check pairs and open the draw](open.md)), and [send the invitations](invitations.md).

## Start next year from this year

On the event page, **Download as a template** (*Downloaden als sjabloon*) saves the event as a file in the same format: the name, the settings and the groups with their dates, but **no participants**, no pairs and no links. Next year, change the name and the dates, fill in the participants (yourself or with the assistant), and import it as a new event.

Settings you never changed, such as the standard theme text or the standard choices, are left out of the file, so after the import they still follow each participant's language.

## The file in detail

The format is described in a JSON Schema at [event.schema.json](../import/event.schema.json), and [example.json](../import/example.json) is a complete example file, the one in the screenshots above. Its dates are in December 2026; to try it out after that, change them first. You only need these if you write or fix a file by hand.

```json
{
  "version": 1,
  "event": {
    "name": "Kerstcadeautjes 2026",
    "language": "nl",
    "wishOptions": ["Chocolade", "Thee", { "label": "Boeken", "question": "Welke schrijver?" }]
  },
  "groups": [
    {
      "name": "Maandagochtend",
      "exchangeDate": "2026-12-14",
      "exchangeTime": "10:00",
      "exchangePlace": "Yogastudio De Lotus, Dorpsstraat 1",
      "participants": ["Cor Bakker", { "name": "Ada de Vries", "email": "ada@example.com" }]
    }
  ]
}
```

| Field | Required | What it is |
|---|---|---|
| `version` | yes | Always `1`. |
| `event.name` | yes | The event's name, at most 100 characters. |
| `event.language` | no | `nl` (default) or `en`: the language participants start in. |
| `event.cleanupWeeks` | no | 1 to 52, default 4. See [Set up an event](event.md#settings). |
| `event.theme` | no | The theme text, at most 2000 characters. Left out: the standard text in each participant's language. |
| `event.wishOptions` | no | The choices under "I like...". Left out: the standard list. |
| `event.sections` | no | Per part of the form (`hobbies`, `likes`, `pets`, `avoid`, `other`): `"show": false` to hide it, `"heading"` for a heading of your own. |
| `event.petOptions` | no | The choices under "Pets", like `wishOptions`. |
| `groups[].name` | yes | The group's name, at most 100 characters. |
| `groups[].exchangeDate` | yes | `YYYY-MM-DD`, today or later. |
| `groups[].exchangeTime` | no | `HH:MM`, 24-hour; `9:30` is read as `09:30`. |
| `groups[].exchangePlace` | no | One line, at most 200 characters. |
| `groups[].autoOpenAt` | no | `YYYY-MM-DD`, today or later and not after the exchange date. |
| `groups[].participants` | no | Names, or `{ "name": ..., "email": ... }`. Up to 500 per group. |

A choice in `wishOptions` or `petOptions` works as one line in the event form's list, described in [Ask a short question with a choice](event.md#ask-a-short-question-with-a-choice):

- `"Thee"` is a plain tick box.
- `"Boeken? Welke schrijver?"` reads as in the event form: the text after the question mark is the question, and `"Wijn?"` alone asks the general question.
- `{ "label": "Boeken", "question": "Welke schrijver?" }` asks that question once the box is ticked.
- `{ "label": "Wijn", "askDetails": true }` asks the general question "Anything in particular?" in the participant's language. For the built-in chocolate choice it asks "Which flavour?", so write `{ "label": "Chocolade", "askDetails": true }` to keep that question; plain `"Chocolade"` asks nothing.
- A label that matches a built-in choice in Dutch or English (`Thee` or `Tea`) is shown translated for each participant; any other label is shown as written.

Other rules the check enforces:

- A field the app does not know is refused, so a misspelt `exchange_date` is reported rather than silently ignored.
- Spaces and line breaks inside a name, place, heading or question become single spaces, as they could not be typed in the one-line form fields. The theme keeps its line breaks.
- A participant whose name is an email address, with no `email`, is refused: the name is missing.
- Lengths count as the form fields count them: most emoji count as two characters.
- Email addresses are checked and stored the same way as when you paste a list. An empty `"email": ""` means no address.
- A file can hold at most 50 groups and 150,000 characters.
