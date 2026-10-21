# Calories Shortcut: "ReadBadmintonCalories"

Web pages can't read Apple Health, so the 读取 (Read) button on an event card runs this Shortcut.
The Shortcut is generic: it holds no account or secret, so anyone can install it.
The site runs it with `shortcuts://run-shortcut?name=ReadBadmintonCalories&input=text&text=…`, and the text it passes in is:

```json
{ "start": "2026-10-21T03:30:00.000Z", "end": "2026-10-21T05:30:00.000Z", "upload": "https://…/api/calories/<one-time code>" }
```

`upload` works once, for 15 minutes, and only writes this member's calories for this one event
(`POST` with JSON `{"kcal": 432}`, 0–3000).

## Build it once on an iPhone (the Owner does this, then shares the iCloud link)

Open the Shortcuts app and create a new shortcut. Its name must be exactly **ReadBadmintonCalories**:
the site runs it by name. Add these actions in order:

1. **Get Dictionary from Input**: input is "Shortcut Input".
2. **Get Dictionary Value**: key `start`. Then **Get Dates from Input** on that "Dictionary Value";
   rename the result to "Start".
3. Do the same for key `end` to get "End".
4. Another **Get Dictionary Value** for key `upload` (from the "Dictionary" of step 1); rename it to "Upload URL".
5. **Find Health Samples**: type "Active Energy", add the filter "Start Date is between Start and End", unit kcal.
6. **Calculate Statistics**: "Sum" of "Health Samples".
7. **Round Number**: to Ones place.
8. **Get Contents of URL**: URL is "Upload URL", method `POST`, request body "JSON",
   add a "Number" field `kcal` with the value "Rounded Number".
9. **Show Notification**: "Recorded 〔Rounded Number〕 kcal. Go back to the site to see it."

In the shortcut's details (ⓘ), make sure it accepts "Text" as input; nothing else needs to be turned on.

When it's done: long-press the shortcut → Share → Copy iCloud Link, and put the link into
`SHORTCUT_INSTALL_URL` in `src/shared/calories.ts`.

## What to check when testing

- The first run asks for permission to read "Active Energy": tap Allow.
- Try it on an event that has already ended, and compare the number with Active Energy for the same
  time span in the Health app. Both iPhone and Apple Watch record active energy, and Find Health
  Samples returns the raw samples, so adding both sources may count twice. If the number is too high,
  add the filter "Source is 〔your Apple Watch〕" in step 5. A shortcut built that way only fits your
  own devices, so it needs another approach (for example grouping by hour) before it's shared.
- Active Energy is only there for people who wore an Apple Watch while playing (an iPhone alone, or a scale, records none). A total of 0 is not saved, so the card keeps offering 读取.
