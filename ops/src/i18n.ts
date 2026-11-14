// The release site in 简体 / 繁體 / English, chosen with the 文A button in the top bar (the same scheme
// as the badminton sites). Simplified Chinese is the key; MESSAGES gives the other two. The choice is a
// cookie, so the server-drawn page, the API's errors and app.js all speak the same language.
// Telegram notices to the developers' group stay in Chinese.

export type Lang = "zh-CN" | "zh-TW" | "en";
export const LANGS: { id: Lang; name: string }[] = [
  { id: "zh-CN", name: "简体中文" },
  { id: "zh-TW", name: "繁體中文" },
  { id: "en", name: "English" },
];
export const LANG_COOKIE = "ops-lang";
export const isLang = (s: unknown): s is Lang => LANGS.some((l) => l.id === s);

/** The saved choice, else like the badminton sites: Traditional Chinese browsers get 繁體, the rest 简体. */
export function langOf(req: Request): Lang {
  for (const part of (req.headers.get("Cookie") ?? "").split(/;\s*/)) {
    const [k, v] = part.split("=");
    if (k === LANG_COOKIE && isLang(v)) return v;
  }
  const first = (req.headers.get("Accept-Language") ?? "").split(",")[0]!.trim().toLowerCase();
  return /^zh-(hant|tw|hk|mo)/.test(first) ? "zh-TW" : "zh-CN";
}

export const MESSAGES: Record<string, { tw: string; en: string }> = {
  // The page shell and sign-in.
  站点发布管理: { tw: "站點發布管理", en: "Release Service" },
  "语言：{name}": { tw: "語言：{name}", en: "Language: {name}" },
  退出: { tw: "登出", en: "Sign out" },
  还不能用: { tw: "還不能用", en: "Not ready yet" },
  "只有管理员的 Google 账号可以登录。": {
    tw: "只有管理員的 Google 帳號可以登入。",
    en: "Only the admin's Google account can sign in.",
  },
  "用 Google 登录": { tw: "用 Google 登入", en: "Sign in with Google" },
  "正在读取…": { tw: "正在讀取…", en: "Loading…" },
  "登录没有完成，请再试一次。": { tw: "登入沒有完成，請再試一次。", en: "Sign-in didn't finish. Please try again." },
  "这个 Google 账号不能管理发布。": {
    tw: "這個 Google 帳號不能管理發布。",
    en: "This Google account can't manage releases.",
  },
  "还没有 Google 登录的设置（GOOGLE_CLIENT_ID）": {
    tw: "還沒有 Google 登入的設定（GOOGLE_CLIENT_ID）",
    en: "Google sign-in isn't set up yet (GOOGLE_CLIENT_ID)",
  },
  "还没有设置允许登录的邮箱（GitHub secret OPS_EMAIL）": {
    tw: "還沒有設定允許登入的信箱（GitHub secret OPS_EMAIL）",
    en: "No email is allowed to sign in yet (GitHub secret OPS_EMAIL)",
  },
  "还没有登录密钥（下次部署时自动生成）": {
    tw: "還沒有登入金鑰（下次部署時自動產生）",
    en: "No sign-in key yet (made automatically on the next deploy)",
  },

  // API errors.
  来源不对: { tw: "來源不對", en: "Wrong origin" },
  请先登录: { tw: "請先登入", en: "Please sign in first" },
  "还没有设置 GitHub 令牌（GitHub secret OPS_GITHUB_TOKEN）": {
    tw: "還沒有設定 GitHub 權杖（GitHub secret OPS_GITHUB_TOKEN）",
    en: "No GitHub token yet (GitHub secret OPS_GITHUB_TOKEN)",
  },
  "读取失败：{msg}": { tw: "讀取失敗：{msg}", en: "Couldn't load: {msg}" },
  页码不对: { tw: "頁碼不對", en: "Invalid page number" },
  请选择站点: { tw: "請選擇站點", en: "Please choose a site" },
  版本不对: { tw: "版本不對", en: "Invalid version" },
  "请输入 {id} 确认": { tw: "請輸入 {id} 確認", en: "Type {id} to confirm" },
  "没能开始恢复：{msg}": { tw: "沒能開始恢復：{msg}", en: "Couldn't start the restore: {msg}" },
  请刷新页面再试: { tw: "請重新整理頁面再試", en: "Please refresh the page and try again" },
  "main 上有了新的改动，页面已经刷新，请看过再发布": {
    tw: "main 上有了新的改動，頁面已經重新整理，請看過再發布",
    en: "main has new changes. The page has refreshed; please look them over before releasing.",
  },
  "没能开始发布：{msg}": { tw: "沒能開始發布：{msg}", en: "Couldn't start the release: {msg}" },
  找不到这个地址: { tw: "找不到這個網址", en: "Not found" },

  // The page (app.js).
  读取失败: { tw: "讀取失敗", en: "Couldn't load" },
  再试一次: { tw: "再試一次", en: "Try again" },
  "全部 {n} 个站点": { tw: "全部 {n} 個站點", en: "all {n} sites" },
  "把 {tag} 发布到：{names}？": { tw: "把 {tag} 發布到：{names}？", en: "Release {tag} to {names}?" },
  "从 main 打新版本 {tag} 并发布到：{names}？": {
    tw: "從 main 打新版本 {tag} 並發布到：{names}？",
    en: "Make new version {tag} from main and release it to {names}?",
  },
  "每个站点发布前都会先备份数据库，约 3–5 分钟完成。": {
    tw: "每個站點發布前都會先備份資料庫，約 3–5 分鐘完成。",
    en: "Each site's database is backed up first. It takes about 3–5 minutes.",
  },
  没能开始发布: { tw: "沒能開始發布", en: "Couldn't start the release" },
  "已开始发布，下面「最近的部署」会显示进度": {
    tw: "已開始發布，下面「最近的部署」會顯示進度",
    en: "Release started. Recent deploys below shows its progress.",
  },
  没有新改动: { tw: "沒有新改動", en: "No new changes" },
  "main 上的改动都已经在 {tag} 里了": {
    tw: "main 上的改動都已經在 {tag} 裡了",
    en: "Everything on main is already in {tag}",
  },
  最新版本: { tw: "最新版本", en: "the latest version" },
  测试站已通过: { tw: "測試站已通過", en: "passed on staging" },
  测试站还在测试: { tw: "測試站還在測試", en: "still testing on staging" },
  "测试没通过，先别发布": { tw: "測試沒通過，先別發布", en: "tests failed, don't release yet" },
  还没有测试结果: { tw: "還沒有測試結果", en: "no test result yet" },
  "发布 {tag}": { tw: "發布 {tag}", en: "Release {tag}" },
  请至少选一个站点: { tw: "請至少選一個站點", en: "Choose at least one site" },
  "还有 {n} 个": { tw: "還有 {n} 個", en: "{n} more" },
  新版本可以发布: { tw: "新版本可以發布", en: "A new version is ready" },
  "main 比 {tag} 多 {n} 个改动": { tw: "main 比 {tag} 多 {n} 個改動", en: "main has {n} changes since {tag}" },
  上个版本: { tw: "上個版本", en: "the last version" },
  "发布到：": { tw: "發布到：", en: "Release to:" },
  测试: { tw: "測試", en: "Test" },
  备份: { tw: "備份", en: "Backup" },
  迁移: { tw: "遷移", en: "Migrate" },
  部署: { tw: "部署", en: "Deploy" },
  检查: { tw: "檢查", en: "Check" },
  版本未知: { tw: "版本未知", en: "Version unknown" },
  打不开: { tw: "打不開", en: "Down" },
  "落后 {n}": { tw: "落後 {n}", en: "{n} behind" },
  下次发布后显示: { tw: "下次發布後顯示", en: "Shown after next release" },
  正常: { tw: "正常", en: "OK" },
  "{name} 正在发布，完成后再换版本": {
    tw: "{name} 正在發布，完成後再換版本",
    en: "{name} is being released. Change its version when that's done.",
  },
  "已用 {m} 分 {s} 秒": { tw: "已用 {m} 分 {s} 秒", en: "{m} min {s} s so far" },
  正在恢复数据库: { tw: "正在恢復資料庫", en: "Restoring the database" },
  "正在发布 {tag}": { tw: "正在發布 {tag}", en: "Releasing {tag}" },
  正在准备发布: { tw: "正在準備發布", en: "Preparing the release" },
  "详情 ›": { tw: "詳情 ›", en: "Details ›" },
  "{n} 个站点": { tw: "{n} 個站點", en: "{n} sites" },
  "先备份、恢复，再换版本，一般 8 分钟左右": {
    tw: "先備份、恢復，再換版本，一般 8 分鐘左右",
    en: "back up, restore, then switch, usually about 8 minutes",
  },
  "一般 5 分钟左右": { tw: "一般 5 分鐘左右", en: "usually about 5 minutes" },
  还没有记录: { tw: "還沒有紀錄", en: "Nothing yet" },
  "✗ 发布没开始，点开看原因": { tw: "✗ 發布沒開始，點開看原因", en: "✗ Release didn't start, tap to see why" },
  准备中: { tw: "準備中", en: "Preparing" },
  没有部署: { tw: "沒有部署", en: "Not deployed" },
  全部: { tw: "全部", en: "All" },
  选一个版本: { tw: "選一個版本", en: "Choose a version" },
  当前: { tw: "目前", en: "Current" },
  "太旧，不能在这里换": { tw: "太舊，不能在這裡換", en: "Too old to switch here" },
  "需恢复 🔒": { tw: "需恢復 🔒", en: "Needs restore 🔒" },
  最新: { tw: "最新", en: "Latest" },
  较新: { tw: "較新", en: "Newer" },
  回滚: { tw: "回滾", en: "Roll back" },
  "恢复备份并换到 {tag}": { tw: "恢復備份並換到 {tag}", en: "Restore backup and switch to {tag}" },
  "换到 {tag}": { tw: "換到 {tag}", en: "Switch to {tag}" },
  说明: { tw: "說明", en: "Notes" },
  "读取中…": { tw: "讀取中…", en: "Loading…" },
  没有找到这一版的说明: { tw: "沒有找到這一版的說明", en: "No notes found for this version" },
  "没读到说明，请再点一次": { tw: "沒讀到說明，請再點一次", en: "Couldn't load the notes, tap again" },
  "‹ 返回": { tw: "‹ 返回", en: "‹ Back" },
  "{domain}（现在打不开）。": { tw: "{domain}（現在打不開）。", en: "{domain} (down right now)." },
  "{domain}。": { tw: "{domain}。", en: "{domain}." },
  "现在是 {tag}。": { tw: "現在是 {tag}。", en: "Now on {tag}." },
  "换版本前会自动备份这个站点的数据库。回滚到更早的版本，如果数据库已经有它不认识的改动，会被自动拒绝。": {
    tw: "換版本前會自動備份這個站點的資料庫。回滾到更早的版本時，如果資料庫已經有它不認識的改動，會被自動拒絕。",
    en: "This site's database is backed up before switching. A rollback is refused automatically if the database has changes the older version doesn't know.",
  },
  没有说明: { tw: "沒有說明", en: "No notes" },
  "恢复 {name} 的数据库": { tw: "恢復 {name} 的資料庫", en: "Restore {name}'s database" },
  "数据库会回到它第一次执行 {tag} 不认识的数据库改动之前{when}，然后换到 {tag}。": {
    tw: "資料庫會回到它第一次執行 {tag} 不認識的資料庫改動之前{when}，然後換到 {tag}。",
    en: "The database goes back to just before it first ran a database change {tag} doesn't know{when}, then the site switches to {tag}.",
  },
  "（不早于 {date}，{from} 发布的时间）": {
    tw: "（不早於 {date}，{from} 發布的時間）",
    en: " (no earlier than {date}, when {from} came out)",
  },
  "这之后这个站点上的报名、付款、设置改动都会丢失。": {
    tw: "這之後這個站點上的報名、付款、設定改動都會遺失。",
    en: "Sign-ups, payments and settings changed on this site since then will be lost.",
  },
  "恢复前会先把现在的数据库备份一份（保存 90 天），万一需要还能找回。只能恢复到 30 天以内。其他站点不受影响。": {
    tw: "恢復前會先把現在的資料庫備份一份（保存 90 天），萬一需要還能找回。只能恢復到 30 天以內。其他站點不受影響。",
    en: "The current database is backed up first (kept 90 days) so it can be brought back if needed. Restores reach back 30 days at most. Other sites aren't affected.",
  },
  "请输入 {id} 确认：": { tw: "請輸入 {id} 確認：", en: "Type {id} to confirm:" },
  取消: { tw: "取消", en: "Cancel" },
  "恢复并换到 {tag}": { tw: "恢復並換到 {tag}", en: "Restore and switch to {tag}" },
  没能开始恢复: { tw: "沒能開始恢復", en: "Couldn't start the restore" },
  "已开始恢复，完成后会自动换到 {tag}": {
    tw: "已開始恢復，完成後會自動換到 {tag}",
    en: "Restore started. The site switches to {tag} when it's done.",
  },
  加载更多: { tw: "載入更多", en: "Load more" },
  "在用：{names}": { tw: "在用：{names}", en: "Running on: {names}" },
  "没读到，点这里重试（{msg}）": { tw: "沒讀到，點這裡重試（{msg}）", en: "Couldn't load, tap to retry ({msg})" },
  所有版本: { tw: "所有版本", en: "All versions" },
  所有版本和发布说明: { tw: "所有版本和發布說明", en: "All versions and release notes" },
  各站点: { tw: "各站點", en: "Sites" },
  最近的部署: { tw: "最近的部署", en: "Recent deploys" },
  松开刷新: { tw: "鬆開重新整理", en: "Release to refresh" },
  下拉刷新: { tw: "下拉重新整理", en: "Pull to refresh" },
  "刷新中…": { tw: "重新整理中…", en: "Refreshing…" },

  // Progress labels from logic.ts progressOf and github.ts.
  测试没通过: { tw: "測試沒通過", en: "Tests failed" },
  测试中: { tw: "測試中", en: "Testing" },
  "等 Jay's 先发": { tw: "等 Jay's 先發", en: "After Jay's" },
  排队中: { tw: "排隊中", en: "Queued" },
  完成: { tw: "完成", en: "Done" },
  恢复中: { tw: "恢復中", en: "Restoring" },
  测试失败: { tw: "測試失敗", en: "Test failed" },
  备份失败: { tw: "備份失敗", en: "Backup failed" },
  迁移失败: { tw: "遷移失敗", en: "Migrate failed" },
  部署失败: { tw: "部署失敗", en: "Deploy failed" },
  检查失败: { tw: "檢查失敗", en: "Check failed" },
  备份中: { tw: "備份中", en: "Backing up" },
  迁移中: { tw: "遷移中", en: "Migrating" },
  部署中: { tw: "部署中", en: "Deploying" },
  检查中: { tw: "檢查中", en: "Checking" },
};

/** One text in the chosen language, with {name} filled in. Unknown keys show as they are. */
export function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const m = MESSAGES[key];
  const s = lang === "zh-CN" || !m ? key : lang === "en" ? m.en : m.tw;
  return s.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all));
}
