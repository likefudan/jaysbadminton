# Calories Shortcut: "ReadBadmintonCalories"

Web pages can't read Apple Health, so the 读取 (Read) button on an event card runs this Shortcut.
The Shortcut is generic: it holds no account or secret, so anyone can install it.
The site runs it with `shortcuts://run-shortcut?name=ReadBadmintonCalories&input=text&text=…`, and the text it passes in is:

```json
{ "start": "2026-05-26 20:20", "end": "2026-05-26 23:00", "upload": "https://…/api/calories/<one-time code>" }
```

`start` and `end` are Pacific wall-clock times. `start` is 10 minutes before the event starts, so the
warm-up counts too. Shortcuts can only filter Health samples by whole days, so the Shortcut fetches the
samples from the start day to the day after the end, and keeps those whose start time, as a
yyyyMMddHHmm number, is between the two. Plain numbers also work past midnight.

`upload` works once, for 15 minutes, and only writes this member's calories for this one event
(`POST` with JSON `{"kcal": 432}`, 0–3000; 0 is not saved).

## Build it once on an iPhone (the Owner does this, then shares the iCloud link)

Open the Shortcuts app and create a new shortcut. Its name must be exactly **ReadBadmintonCalories**:
the site runs it by name. Add these actions in order:

1. **Get Dictionary from Input**: input is "Shortcut Input" (the top "Receive" row: Text).
2. **Get Dictionary Value**: key `start`. Then **Get Dates from Input** on it; rename the result **StartDate**.
3. **Get Dictionary Value**: key `end`. Then **Get Dates from Input** on it; rename the result **EndDate**.
4. **Get Dictionary Value**: key `upload`, rename **Upload**.
5. **Adjust Date**: add 1 day to EndDate, rename **Until** ("is between" leaves out its last day).
6. **Format Date**: StartDate, Custom `yyyyMMddHHmm`. **Get Numbers from Input** on it, rename **From**.
7. **Format Date**: EndDate, Custom `yyyyMMddHHmm`. **Get Numbers from Input** on it, rename **To**.
8. **Find Health Samples**: type "Active Energy" (shown as Active Calories), one filter
   "Start Date is between StartDate and Until", unit **kcal**, **Group by Minute**, no limit.
   Grouping adds up each minute's samples first: an Apple Watch can write thousands of tiny samples in
   an evening, and repeating over each of them made the Shortcut far too slow.
9. **Repeat with Each** item in "Health Samples". Inside the repeat:
   1. **Get Details of Health Sample**: "Start Date" of "Repeat Item".
   2. **Format Date**: that "Start Date", Custom `yyyyMMddHHmm`.
   3. **Get Numbers from Input**: "Formatted Date".
   4. **If** "Numbers" **is between** From and To: **Get Details of Health Sample**: "Value" of "Repeat Item".
      **Otherwise**: a **Number** action with `0`. Don't leave Otherwise empty: an empty branch passes
      the yyyyMMddHHmm number on, and the sum becomes huge.
10. **Calculate Statistics**: "Sum" of "Repeat Results".
11. **Round Number**: to Ones place / Integer.
12. **Get Contents of URL**: URL is Upload, method `POST`, request body "JSON",
    add a "Number" field `kcal` with the value "Rounded Number", and a "Number" field `v` with the
    Shortcut's version (now `2`).
13. **Show Notification**: "Recorded 〔Rounded Number〕 kcal".

To try it without the site, set "If there's no input" on the Receive row to **Ask For Text**, run it, and
paste for example `{"start":"2026-05-26 20:30","end":"2026-05-26 23:00","upload":"https://example.com/test"}`
(the upload then fails, which is fine; the notification shows the number). Set it back to Continue.

When it's done: long-press the shortcut → Share → Copy iCloud Link, and paste the link into
管理 → 设置 → 「卡路里快捷指令」 (the Owner or an admin). `SHORTCUT_INSTALL_URL` in
`src/shared/calories.ts` is only the default until that is saved.

## Changing the Shortcut later

Members keep the copy they installed; a new iCloud link doesn't update it. So for every change:
raise `v` in step 12, share a new iCloud link, and save the link and the new `v` together in
管理 → 设置 → 「卡路里快捷指令」. No deploy is needed. The site remembers
the `v` of each member's last upload (none sent = 1); while 读取 is open, members behind get
「快捷指令有新版本，点这里更新」 on the event card, and their number is still saved.

## What to check when testing

- The first run asks for permission to read "Active Energy": tap Allow.
- Compare the number with Active Energy for the same time span in the Health app. On Ke Li's iPhone the
  whole-day sum matched the Health app, so iPhone and Apple Watch samples are not counted twice there.
- Active Energy is only there for people who wore an Apple Watch while playing (an iPhone alone, or a scale, records none). A total of 0 is not saved, so the card keeps offering 读取.
