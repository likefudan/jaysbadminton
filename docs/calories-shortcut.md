# Calories Shortcut: "ReadBadmintonCalories"

Web pages can't read Apple Health, so the 读取 (Read) button on an event card runs this Shortcut.
The Shortcut is generic: it holds no account or secret, so anyone can install it.
The site runs it with `shortcuts://run-shortcut?name=ReadBadmintonCalories&input=text&text=…`, and the text it passes in is:

```json
{ "day": "2026-05-26", "from": 2030, "to": 2300, "upload": "https://…/api/calories/<one-time code>" }
```

`day` is the event's Pacific date; `from` and `to` are its start and end as HHmm numbers (2030 = 8:30 PM;
an event past midnight gets `to` 2359). Shortcuts can only filter Health samples by day, and "Get Dates
from Input" doesn't reliably keep the time, so the Shortcut takes that day's samples and keeps those
whose start time, as an HHmm number, is between `from` and `to`.

`upload` works once, for 15 minutes, and only writes this member's calories for this one event
(`POST` with JSON `{"kcal": 432}`, 0–3000; 0 is not saved).

## Build it once on an iPhone (the Owner does this, then shares the iCloud link)

Open the Shortcuts app and create a new shortcut. Its name must be exactly **ReadBadmintonCalories**:
the site runs it by name. Add these actions in order:

1. **Get Dictionary from Input**: input is "Shortcut Input" (the top "Receive" row: Text).
2. **Get Dictionary Value**: key `day`. Then **Get Dates from Input** on that "Dictionary Value".
3. **Get Dictionary Value**: key `from` (Dictionary: the one from step 1).
4. **Get Dictionary Value**: key `to` (Dictionary: the one from step 1).
5. **Get Dictionary Value**: key `upload` (Dictionary: the one from step 1).
6. **Find Health Samples**: type "Active Energy" (shown as Active Calories), one filter
   "Start Date is on 〔Dates〕", unit **kcal**, no limit.
7. **Repeat with Each** item in "Health Samples". Inside the repeat:
   1. **Get Details of Health Sample**: "Start Date" of "Repeat Item".
   2. **Format Date**: that "Start Date", Date Format **Custom**, format string `HHmm`, Time Format None.
   3. **Get Numbers from Input**: "Formatted Date".
   4. **If** "Numbers" **is between** the `from` value (step 3) and the `to` value (step 4):
      **Get Details of Health Sample**: "Value" of "Repeat Item". Leave Otherwise empty.
8. **Calculate Statistics**: "Sum" of "Repeat Results".
9. **Round Number**: to Ones place / Integer.
10. **Get Contents of URL**: URL is the `upload` value (step 5), method `POST`, request body "JSON",
    add a "Number" field `kcal` with the value "Rounded Number".
11. **Show Notification**: "Recorded 〔Rounded Number〕 kcal".

To try it without the site, set "If there's no input" on the Receive row to **Ask For Text**, run it, and
paste for example `{"day":"2026-05-26","from":2030,"to":2300,"upload":"https://example.com/test"}`
(the upload then fails, which is fine; the notification shows the number). Set it back to Continue.

When it's done: long-press the shortcut → Share → Copy iCloud Link, and put the link into
`SHORTCUT_INSTALL_URL` in `src/shared/calories.ts`.

## What to check when testing

- The first run asks for permission to read "Active Energy": tap Allow.
- Compare the number with Active Energy for the same time span in the Health app. On Ke Li's iPhone the
  whole-day sum matched the Health app, so iPhone and Apple Watch samples are not counted twice there.
- Active Energy is only there for people who wore an Apple Watch while playing (an iPhone alone, or a scale, records none). A total of 0 is not saved, so the card keeps offering 读取.
