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
  "用 Google 登录。第一次来的人登录后可以申请。": {
    tw: "用 Google 登入。第一次來的人登入後可以申請。",
    en: "Sign in with Google. If you're new, you can apply after signing in.",
  },
  "用 Google 登录": { tw: "用 Google 登入", en: "Sign in with Google" },
  "正在读取…": { tw: "正在讀取…", en: "Loading…" },
  "登录没有完成，请再试一次。": { tw: "登入沒有完成，請再試一次。", en: "Sign-in didn't finish. Please try again." },
  "这个 Google 账号不能用（邮箱还没有验证）。": {
    tw: "這個 Google 帳號不能用（信箱還沒有驗證）。",
    en: "This Google account can't be used (its email isn't verified).",
  },
  "还没有 Google 登录的设置（GOOGLE_CLIENT_ID）": {
    tw: "還沒有 Google 登入的設定（GOOGLE_CLIENT_ID）",
    en: "Google sign-in isn't set up yet (GOOGLE_CLIENT_ID)",
  },
  "还没有设置开发者的邮箱（GitHub secret OPS_EMAIL）": {
    tw: "還沒有設定開發者的信箱（GitHub secret OPS_EMAIL）",
    en: "The developer's email isn't set yet (GitHub secret OPS_EMAIL)",
  },

  // Applying, and the owner's 用户和权限 panel.
  "请填写你的名字。": { tw: "請填寫你的名字。", en: "Please enter your name." },
  "申请的人太多了，请稍后再试。": {
    tw: "申請的人太多了，請稍後再試。",
    en: "Too many applications. Please try later.",
  },
  "这个账号的申请已经处理过了。": {
    tw: "這個帳號的申請已經處理過了。",
    en: "This account's application has already been decided.",
  },
  "已登录：{email}": { tw: "已登入：{email}", en: "Signed in as {email}" },
  这个账号没有权限: { tw: "這個帳號沒有權限", en: "This account has no access" },
  "有需要请直接联系 {owner}。": {
    tw: "有需要請直接聯絡 {owner}。",
    en: "If you need access, contact {owner} directly.",
  },
  申请已提交: { tw: "申請已送出", en: "Application sent" },
  "等 {owner} 批准后，刷新这个页面就能看到。": {
    tw: "等 {owner} 批准後，重新整理這個頁面就能看到。",
    en: "Once {owner} approves it, reload this page to see the site.",
  },
  "你写的说明：{note}": { tw: "你寫的說明：{note}", en: "Your note: {note}" },
  申请使用: { tw: "申請使用", en: "Apply for access" },
  "这个网站管理各羽毛球网站的发布。申请后，{owner} 批准了你才能查看；发布、回滚和恢复只有发布工程师可以做。": {
    tw: "這個網站管理各羽毛球網站的發布。申請後，{owner} 批准了你才能查看；發布、回滾和恢復只有發布工程師可以做。",
    en: "This site manages releases of the badminton sites. After you apply, you can view it once {owner} approves; only release engineers can release, roll back and restore.",
  },
  你的名字: { tw: "你的名字", en: "Your name" },
  "说明（可不填）": { tw: "說明（可不填）", en: "Note (optional)" },
  "比如：你是谁，为什么需要": { tw: "比如：你是誰，為什麼需要", en: "E.g. who you are and why you need it" },
  提交申请: { tw: "送出申請", en: "Apply" },
  还没有批准: { tw: "還沒有批准", en: "Not approved yet" },
  "只有 {name} 可以管理用户": { tw: "只有 {name} 可以管理使用者", en: "Only {name} can manage users" },
  找不到这个用户: { tw: "找不到這個使用者", en: "No such user" },
  操作不对: { tw: "操作不對", en: "Unknown action" },
  "只有发布工程师可以发布、回滚和恢复": {
    tw: "只有發布工程師可以發布、回滾和恢復",
    en: "Only release engineers can release, roll back and restore",
  },
  "你是只读用户：可以查看，发布、回滚和恢复只有发布工程师可以做。": {
    tw: "你是唯讀使用者：可以查看，發布、回滾和恢復只有發布工程師可以做。",
    en: "You have view-only access: only release engineers can release, roll back and restore.",
  },
  用户和权限: { tw: "使用者和權限", en: "Users and roles" },
  "{n} 个申请": { tw: "{n} 個申請", en: "{n} waiting" },
  "只读用户可以看这个页面；发布工程师还可以发布、回滚和恢复。取消权限后对方立刻不能再用。": {
    tw: "唯讀使用者可以看這個頁面；發布工程師還可以發布、回滾和恢復。取消權限後對方立刻不能再用。",
    en: "Viewers can see this page; release engineers can also release, roll back and restore. Removing access takes effect at once.",
  },
  还没有人申请: { tw: "還沒有人申請", en: "No applications yet" },
  "申请于 {when}": { tw: "申請於 {when}", en: "applied {when}" },
  没能保存: { tw: "沒能儲存", en: "Couldn't save" },
  等批准: { tw: "等批准", en: "Waiting" },
  发布工程师: { tw: "發布工程師", en: "Release engineer" },
  只读: { tw: "唯讀", en: "View only" },
  没有权限: { tw: "沒有權限", en: "No access" },
  "批准（只读）": { tw: "批准（唯讀）", en: "Approve (view only)" },
  批准为发布工程师: { tw: "批准為發布工程師", en: "Approve as release engineer" },
  拒绝: { tw: "拒絕", en: "Reject" },
  设为发布工程师: { tw: "設為發布工程師", en: "Make release engineer" },
  取消权限: { tw: "取消權限", en: "Remove access" },
  改为只读: { tw: "改為唯讀", en: "Change to view only" },
  "删除（可以重新申请）": { tw: "刪除（可以重新申請）", en: "Delete (may apply again)" },
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

  // 总入口: the home page and 开发者设置 (home.ts).
  羽毛球: { tw: "羽毛球", en: "Badminton" },
  首页: { tw: "首頁", en: "Home" },
  开发者设置: { tw: "開發者設定", en: "Developer settings" },
  站点管理: { tw: "站點管理", en: "Site management" },
  "各站点的版本、发布、回滚和恢复（Release Service）": {
    tw: "各站點的版本、發布、回滾和恢復（Release Service）",
    en: "Each site's version, releases, rollbacks and restores (Release Service)",
  },
  "用 Google 登录，查看你加入的羽毛球群和近期活动。": {
    tw: "用 Google 登入，查看你加入的羽毛球群和近期活動。",
    en: "Sign in with Google to see your badminton groups and their coming events.",
  },
  近期活动: { tw: "近期活動", en: "Coming events" },
  "最近没有活动。": { tw: "最近沒有活動。", en: "No events coming up." },
  我的群: { tw: "我的群", en: "My groups" },
  还没有找到你加入的群: { tw: "還沒有找到你加入的群", en: "No groups found for you yet" },
  "用这个 Google 账号（{email}）在群自己的网站上加入后，群和活动就会出现在这里。": {
    tw: "用這個 Google 帳號（{email}）在群自己的網站上加入後，群和活動就會出現在這裡。",
    en: "Once you join a group on its own site with this Google account ({email}), the group and its events show up here.",
  },
  已报名: { tw: "已報名", en: "Signed up" },
  可报名: { tw: "可報名", en: "Open" },
  "{n} 人": { tw: "{n} 人", en: "{n} going" },
  等待审核: { tw: "等待審核", en: "Awaiting approval" },
  "待付 ${amount}": { tw: "待付 ${amount}", en: "${amount} due" },
  管理: { tw: "管理", en: "Manage" },
  群主: { tw: "群主", en: "Owner" },
  管理员: { tw: "管理員", en: "Admin" },
  组织者: { tw: "組織者", en: "Organizer" },

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
