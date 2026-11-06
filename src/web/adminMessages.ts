// Translations for the admin pages (群主, 管理员, 组织者), keyed by the Simplified Chinese in the code.
// zh-TW was converted from Simplified (OpenCC, Taiwan phrasing, same word choices as messages.ts)
// and then read over by hand. Kept apart from messages.ts only to keep each file a readable size.

export const ADMIN_MESSAGES: Record<string, { tw: string; en: string }> = {
  地址: { tw: "地址", en: "Address" },
  "搜索中…": { tw: "搜尋中…", en: "Searching…" },
  "输入地址或球馆名，会自动联想": {
    tw: "輸入地址或球館名，會自動聯想",
    en: "Type an address or venue name for suggestions",
  },
  开发者登录: { tw: "開發者登入", en: "Developer sign-in" },
  "用测试环境的群主密码登录，快速切换群主和普通测试成员界面。": {
    tw: "用測試環境的群主密碼登入，快速切換群主和普通測試成員介面。",
    en: "Sign in with the test site's owner password to switch quickly between the owner view and a regular test member's view.",
  },
  开发者密码: { tw: "開發者密碼", en: "Developer password" },
  "登录中…": { tw: "登入中…", en: "Signing in…" },
  开发者工具: { tw: "開發者工具", en: "Developer tools" },
  切换测试界面: { tw: "切換測試介面", en: "Switch test view" },
  "当前：{view}": { tw: "當前：{view}", en: "Current: {view}" },
  群主界面: { tw: "群主介面", en: "Owner view" },
  普通用户界面: { tw: "普通使用者介面", en: "Member view" },
  退出开发者登录: { tw: "退出開發者登入", en: "Sign out of developer mode" },
  "开发者 · 切换界面": { tw: "開發者 · 切換介面", en: "Developer · switch view" },
  "你没有未归档的活动。": { tw: "你沒有未歸檔的活動。", en: "You have no events that aren't archived." },
  "他没有未归档的活动。": { tw: "他沒有未歸檔的活動。", en: "They have no events that aren't archived." },
  "还没结算的活动换了收款人以后，你本人和挂在你名下的朋友也要和别人一样付钱。": {
    tw: "還沒結算的活動換了收款人以後，你本人和掛在你名下的朋友也要和別人一樣付錢。",
    en: "Once an unbilled event gets a new payee, you and the friends under you pay like everyone else.",
  },
  "还没结算的活动换了收款人以后，他本人和挂在他名下的朋友也要和别人一样付钱。": {
    tw: "還沒結算的活動換了收款人以後，他本人和掛在他名下的朋友也要和別人一樣付錢。",
    en: "Once an unbilled event gets a new payee, they and the friends under them pay like everyone else.",
  },
  "还没结算：负责人和收款人都转给群主": {
    tw: "還沒結算：負責人和收款人都轉給群主",
    en: "Not billed yet: manager and payee both move to the owner",
  },
  "收款中：由群主接手管理，钱继续付到你的账户，直到收齐": {
    tw: "收款中：由群主接手管理，錢繼續付到你的帳戶，直到收齊",
    en: "Collecting: the owner takes over; payments keep going to your account until everyone has paid",
  },
  "收款中：由群主接手管理，钱继续付到他的账户，直到收齐": {
    tw: "收款中：由群主接手管理，錢繼續付到他的帳戶，直到收齊",
    en: "Collecting: the owner takes over; payments keep going to their account until everyone has paid",
  },
  "收款中：负责人转给群主，收款人不变": {
    tw: "收款中：負責人轉給群主，收款人不變",
    en: "Collecting: manager moves to the owner, payee stays the same",
  },
  "收款中：负责人不变，钱继续付到你的账户，直到收齐": {
    tw: "收款中：負責人不變，錢繼續付到你的帳戶，直到收齊",
    en: "Collecting: manager stays the same; payments keep going to your account until everyone has paid",
  },
  "收款中：负责人不变，钱继续付到他的账户，直到收齐": {
    tw: "收款中：負責人不變，錢繼續付到他的帳戶，直到收齊",
    en: "Collecting: manager stays the same; payments keep going to their account until everyone has paid",
  },
  "还没结算：收款人转给群主，负责人不变": {
    tw: "還沒結算：收款人轉給群主，負責人不變",
    en: "Not billed yet: payee moves to the owner, manager stays the same",
  },
  "还没结算：负责人转给群主，收款人不变": {
    tw: "還沒結算：負責人轉給群主，收款人不變",
    en: "Not billed yet: manager moves to the owner, payee stays the same",
  },
  "{what}：{label}": { tw: "{what}：{label}", en: "{what}: {label}" },
  "会受影响的活动：": { tw: "會受影響的活動：", en: "Events affected:" },
  前往开发者登录: { tw: "前往開發者登入", en: "Go to developer sign-in" },
  链接无效: { tw: "連結無效", en: "Invalid link" },
  "这个管理链接已失效。": { tw: "這個管理連結已失效。", en: "This admin link no longer works." },
  活动: { tw: "活動", en: "Events" },
  收款: { tw: "收款", en: "Payments" },
  待审核: { tw: "待審核", en: "Pending" },
  成员: { tw: "成員", en: "Members" },
  设置: { tw: "設定", en: "Settings" },
  管理页登录: { tw: "管理頁登入", en: "Admin sign-in" },
  群主登录: { tw: "群主登入", en: "Owner sign-in" },
  "当前登录的 Google 账号 {email} 不是群主绑定的账号，也不是管理员或组织者。": {
    tw: "當前登入的 Google 帳號 {email} 不是群主綁定的帳號，也不是管理員或組織者。",
    en: "The Google account you're signed in with ({email}) isn't the one the owner linked, and isn't an admin or organizer.",
  },
  "当前登录的 Google 账号 {email} 不是群主绑定的账号。": {
    tw: "當前登入的 Google 帳號 {email} 不是群主綁定的帳號。",
    en: "The Google account you're signed in with ({email}) isn't the one the owner linked.",
  },
  "换一个 Google 账号登录": { tw: "換一個 Google 帳號登入", en: "Sign in with a different Google account" },
  "使用 Google 登录": { tw: "使用 Google 登入", en: "Sign in with Google" },
  "群主在管理页「设置」里绑定过的 Google 账号，以及管理员和组织者自己的 Google 账号能进。群主没绑定的话，请用管理链接和密码登录。":
    {
      tw: "群主在管理頁「設定」裡綁定過的 Google 帳號，以及管理員和組織者自己的 Google 帳號能進。群主沒綁定的話，請用管理連結和密碼登入。",
      en: "The Google account the owner linked under Settings on the admin page can get in, and so can admins and organizers with their own Google accounts. If the owner hasn't linked one, sign in with the admin link and password.",
    },
  "只有在管理页「设置」里绑定过的那个 Google 账号能进。没绑定的话，请用管理链接和密码登录。": {
    tw: "只有在管理頁「設定」裡綁定過的那個 Google 帳號能進。沒綁定的話，請用管理連結和密碼登入。",
    en: "Only the Google account linked under Settings on the admin page can get in. If none is linked, sign in with the admin link and password.",
  },
  群主密码: { tw: "群主密碼", en: "Owner password" },
  登录: { tw: "登入", en: "Sign in" },
  "登录后这台设备 30 天内不用再输密码。": {
    tw: "登入後這臺裝置 30 天內不用再輸密碼。",
    en: "This device stays signed in for 30 days.",
  },
  "备注：{note}": { tw: "備註：{note}", en: "Note: {note}" },
  群主: { tw: "群主", en: "Owner" },
  管理员: { tw: "管理員", en: "Admin" },
  组织者: { tw: "組織者", en: "Organizer" },
  "微信：{name}": { tw: "微信：{name}", en: "WeChat: {name}" },
  " · 身份：{applicantName}": { tw: " · 身份：{applicantName}", en: " · Identity: {applicantName}" },
  " · 邮箱：{email}": { tw: " · 電子郵件：{email}", en: " · Email: {email}" },
  "‹ 成员": { tw: "‹ 成員", en: "‹ Members" },
  专属链接: { tw: "專屬連結", en: "personal link" },
  审核通知: { tw: "審核通知", en: "approval notice" },
  "专属链接已发到对方的邮箱。": {
    tw: "專屬連結已發到對方的電子郵件。",
    en: "The personal link was sent to their email.",
  },
  "审核通知已发送至对方的 Google 邮箱。": {
    tw: "審核通知已傳送至對方的 Google 電子郵件。",
    en: "The approval notice was sent to their Google email.",
  },
  "成员已通过审核，但邮件服务尚未配置，{what}没有发出。配置后可在成员列表重试，或者把链接私发给对方。": {
    tw: "成員已通過審核，但郵件服務尚未設定，{what}沒有發出。設定後可在成員列表重試，或者把連結私發給對方。",
    en: "Member approved, but email isn't set up, so the {what} wasn't sent. Once it is, retry from the member list, or send them the link privately.",
  },
  "成员已通过审核，但{what}邮件发送失败。可以在成员列表重试，或者把链接私发给对方。": {
    tw: "成員已通過審核，但{what}郵件傳送失敗。可以在成員列表重試，或者把連結私發給對方。",
    en: "Member approved, but the {what} email failed to send. Retry from the member list, or send them the link privately.",
  },
  "成员已通过审核，可以使用 Google 账号登录。": {
    tw: "成員已通過審核，可以使用 Google 帳號登入。",
    en: "Member approved. They can sign in with their Google account.",
  },
  "确定拒绝并删除 {name} 的申请吗？": {
    tw: "確定拒絕並刪除 {name} 的申請嗎？",
    en: "Reject and delete {name}'s application?",
  },
  "{name} 的专属链接": { tw: "{name} 的專屬連結", en: "{name}'s personal link" },
  "已自动发到 {email}；对方没收到时，可以把链接或二维码私发给对方。": {
    tw: "已自動發到 {email}；對方沒收到時，可以把連結或 QR 碼私發給對方。",
    en: "Sent automatically to {email}. If they didn't get it, send them the link or QR code privately.",
  },
  "通过微信私聊发给对方（链接或二维码都可以）。": {
    tw: "透過微信私訊發給對方（連結或 QR 碼都可以）。",
    en: "Send it to them in a WeChat private chat (the link or the QR code).",
  },
  "已通过 {name}": { tw: "已通過 {name}", en: "Approved {name}" },
  "对方是用 Google（{email}）申请的，不用发链接：用这个 Google 账号登录网站就能报名。": {
    tw: "對方是用 Google（{email}）申請的，不用發連結：用這個 Google 帳號登入網站就能報名。",
    en: "They applied with Google ({email}), so there's no link to send: they sign in with that Google account to sign up for events.",
  },
  完成: { tw: "完成", en: "Done" },
  待审核申请: { tw: "待審核申請", en: "Applications" },
  "只有群主和管理员可以通过或拒绝申请。": {
    tw: "只有群主和管理員可以通過或拒絕申請。",
    en: "Only the owner and admins can approve or reject applications.",
  },
  没有待审核的申请: { tw: "沒有待審核的申請", en: "No applications waiting" },
  "留言：{message}": { tw: "留言：{message}", en: "Message: {message}" },
  通过: { tw: "通過", en: "Approve" },
  拒绝: { tw: "拒絕", en: "Reject" },
  "还没用 Google 登录（{n}）": { tw: "還沒用 Google 登入（{n}）", en: "Not signed in with Google yet ({n})" },
  "Google 登录": { tw: "Google 登入", en: "Google sign-in" },
  "✓ 所有成员都已绑定 Google 账号。": {
    tw: "✓ 所有成員都已綁定 Google 帳號。",
    en: "✓ Every member has linked a Google account.",
  },
  "他们打开自己的专属链接，在个人信息里点「绑定 Google 账号」就行。": {
    tw: "他們開啟自己的專屬連結，在個人資訊裡點「綁定 Google 帳號」就行。",
    en: 'They open their personal link and tap "Link Google account" under My info.',
  },
  "另有 {n} 个已停用的成员没有绑定 Google。": {
    tw: "另有 {n} 個已停用的成員沒有綁定 Google。",
    en: "{n} more deactivated member(s) haven't linked Google.",
  },
  "现在还有 {links} 个专属链接有效。": {
    tw: "現在還有 {links} 個專屬連結有效。",
    en: "{links} personal link(s) still work.",
  },
  "已经没有有效的专属链接。": { tw: "已經沒有有效的專屬連結。", en: "No personal links work any more." },
  "重新生成后，{name} 的旧链接会立即失效。继续吗？": {
    tw: "重新生成後，{name} 的舊連結會立即失效。繼續嗎？",
    en: "After regenerating, {name}'s old link stops working right away. Continue?",
  },
  "\n\n{name} 是{title}，停用会先撤销{title}身份。{revokeSummary}": {
    tw: "\n\n{name} 是{title}，停用會先撤銷{title}身份。{revokeSummary}",
    en: "\n\n{name} is {title}; deactivating removes the {title} role first. {revokeSummary}",
  },
  "停用后 {name} 不能再报名，正在报名中的活动会被取消报名；他的链接还能用来付清欠款。{revoke}\n\n继续吗？": {
    tw: "停用後 {name} 不能再報名，正在報名中的活動會被取消報名；他的連結還能用來付清欠款。{revoke}\n\n繼續嗎？",
    en: "Once deactivated, {name} can't sign up any more and is removed from events still open for sign-up; their link still works for paying what they owe.{revoke}\n\nContinue?",
  },
  "把 {name} 设为组织者？\n\n他用 Google 登录后可以发起活动、管理自己的活动，钱付到他自己的 Venmo；也能只读查看成员和待审核。":
    {
      tw: "把 {name} 設為組織者？\n\n他用 Google 登入後可以發起活動、管理自己的活動，錢付到他自己的 Venmo；也能只讀查看成員和待審核。",
      en: "Make {name} an organizer?\n\nAfter signing in with Google they can create events and run their own events, with money paid to their own Venmo. They can also view the member and pending lists, read-only.",
    },
  "{name} 已成为组织者，已发邮件告诉他用 Google 登录后在「管理」里发起活动。": {
    tw: "{name} 已成為組織者，已發郵件告訴他用 Google 登入後在「管理」裡發起活動。",
    en: "{name} is now an organizer. We emailed them to sign in with Google and create events under Admin.",
  },
  "{name} 已成为组织者，但{emailProblem}。请你自己告诉他：用 Google 登录后打开 {origin}/admin/google，先填好收款设置。":
    {
      tw: "{name} 已成為組織者，但{emailProblem}。請你自己告訴他：用 Google 登入後開啟 {origin}/admin/google，先填好收款設定。",
      en: "{name} is now an organizer, but {emailProblem}. Please tell them yourself: sign in with Google, open {origin}/admin/google, and fill in the payment settings first.",
    },
  "撤销 {name} 的{title}身份？{revokeSummary}\n\n撤销后他马上进不了管理页，系统会发邮件告诉他。": {
    tw: "撤銷 {name} 的{title}身份？{revokeSummary}\n\n撤銷後他馬上進不了管理頁，系統會發郵件告訴他。",
    en: "Remove {name}'s {title} role?{revokeSummary}\n\nThey lose access to the admin page right away, and we'll email them.",
  },
  "\n\n他原来的活动、收款设置和 Telegram 都保留。": {
    tw: "\n\n他原來的活動、收款設定和 Telegram 都保留。",
    en: "\n\nTheir existing events, payment settings and Telegram stay as they are.",
  },
  "把 {name} 设为管理员？\n\n他用 Google 登录后可以像群主一样管理整个群：审核和管理成员、任命组织者、管理所有活动和付款、修改设置、导出数据。只有任命管理员、清空数据、密钥和备份、永久删除仍然只有你能做。{kept}":
    {
      tw: "把 {name} 設為管理員？\n\n他用 Google 登入後可以像群主一樣管理整個群：審核和管理成員、任命組織者、管理所有活動和付款、修改設定、匯出資料。只有任命管理員、清空資料、金鑰和備份、永久刪除仍然只有你能做。{kept}",
      en: "Make {name} an admin?\n\nAfter signing in with Google they can run the whole group like the owner: approve and manage members, appoint organizers, manage all events and payments, change settings, and export data. Only you can appoint admins, clear all data, handle keys and backups, and delete permanently.{kept}",
    },
  "{name} 已成为管理员，已发邮件告诉他用 Google 登录后打开管理页。": {
    tw: "{name} 已成為管理員，已發郵件告訴他用 Google 登入後開啟管理頁。",
    en: "{name} is now an admin. We emailed them to sign in with Google and open the admin page.",
  },
  "{name} 已成为管理员，但{emailProblem}。请你自己告诉他：用 Google 登录后打开 {origin}/admin/google。": {
    tw: "{name} 已成為管理員，但{emailProblem}。請你自己告訴他：用 Google 登入後開啟 {origin}/admin/google。",
    en: "{name} is now an admin, but {emailProblem}. Please tell them yourself: sign in with Google and open {origin}/admin/google.",
  },
  "把 {name} 从管理员改为组织者？\n\n他只能管理自己的活动，不再管理成员、别人的活动和设置。他的活动、收款设置和 Telegram 都保留。":
    {
      tw: "把 {name} 從管理員改為組織者？\n\n他只能管理自己的活動，不再管理成員、別人的活動和設定。他的活動、收款設定和 Telegram 都保留。",
      en: "Change {name} from admin to organizer?\n\nThey'll only run their own events, no longer members, other people's events or settings. Their events, payment settings and Telegram stay as they are.",
    },
  "{name} 已改为组织者，并发邮件告诉了他。": {
    tw: "{name} 已改為組織者，並發郵件告訴了他。",
    en: "{name} is now an organizer, and we emailed them.",
  },
  "{name} 已改为组织者，但{emailProblem}。": {
    tw: "{name} 已改為組織者，但{emailProblem}。",
    en: "{name} is now an organizer, but {emailProblem}.",
  },
  "恢复 {name} 为正常成员？": { tw: "恢復 {name} 為正常成員？", en: "Restore {name} as an active member?" },
  "删除 {name}？删除后他的专属链接永久失效，不能恢复；以前的记录会保留。": {
    tw: "刪除 {name}？刪除後他的專屬連結永久失效，不能恢復；以前的記錄會保留。",
    en: "Delete {name}? Their personal link stops working for good and this can't be undone; past records are kept.",
  },
  "已生成新链接，旧链接已失效。请重新发给对方。": {
    tw: "已生成新連結，舊連結已失效。請重新發給對方。",
    en: "New link created; the old one no longer works. Please send it to them again.",
  },
  "成员（{n}）": { tw: "成員（{n}）", en: "Members ({n})" },
  还没有成员: { tw: "還沒有成員", en: "No members yet" },
  重试审核邮件: { tw: "重試審核郵件", en: "Resend approval email" },
  链接: { tw: "連結", en: "Link" },
  重新生成: { tw: "重新生成", en: "Regenerate" },
  生成备用链接: { tw: "生成備用連結", en: "Create backup link" },
  设为组织者: { tw: "設為組織者", en: "Make organizer" },
  升为管理员: { tw: "升為管理員", en: "Promote to admin" },
  设为管理员: { tw: "設為管理員", en: "Make admin" },
  撤销组织者: { tw: "撤銷組織者", en: "Remove organizer" },
  降为组织者: { tw: "降為組織者", en: "Change to organizer" },
  撤销管理员: { tw: "撤銷管理員", en: "Remove admin" },
  停用: { tw: "停用", en: "Deactivate" },
  "已停用（{n}）": { tw: "已停用（{n}）", en: "Deactivated ({n})" },
  "已停用的成员不能报名，但还能打开专属链接付清欠款。": {
    tw: "已停用的成員不能報名，但還能開啟專屬連結付清欠款。",
    en: "Deactivated members can't sign up, but can still open their personal link to pay what they owe.",
  },
  "欠 {amount}": { tw: "欠 {amount}", en: "Owes {amount}" },
  生成链接: { tw: "生成連結", en: "Create link" },
  恢复: { tw: "恢復", en: "Restore" },
  "已删除（{n}）": { tw: "已刪除（{n}）", en: "Deleted ({n})" },
  "专属链接已失效；以前的报名和付款记录仍然保留在统计和导出里。": {
    tw: "專屬連結已失效；以前的報名和付款記錄仍然保留在統計和匯出裡。",
    en: "Personal links no longer work; past sign-ups and payments stay in the stats and exports.",
  },
  群操作记录: { tw: "群操作記錄", en: "Group activity log" },
  还没有记录: { tw: "還沒有記錄", en: "Nothing logged yet" },
  显示更早的记录: { tw: "顯示更早的記錄", en: "Show older entries" },
  通知邮件发送失败: { tw: "通知郵件傳送失敗", en: "the notice email failed to send" },
  "他没有可以收信的邮箱，通知邮件没有发出": {
    tw: "他沒有可以收信的電子郵件，通知郵件沒有發出",
    en: "they have no email address we can send to, so no notice email went out",
  },
  "邮件服务没有配置，通知邮件没有发出": {
    tw: "郵件服務沒有設定，通知郵件沒有發出",
    en: "email isn't set up, so no notice email went out",
  },
  "已撤销 {name} 的{title}身份，并发邮件告诉了他。": {
    tw: "已撤銷 {name} 的{title}身份，並發郵件告訴了他。",
    en: "Removed {name}'s {title} role and emailed them.",
  },
  "已撤销 {name} 的{title}身份，但{emailProblem}。请你自己告诉他：还在收款的活动钱继续付到他的账户，收到后和你核对；之后可以删掉 Venmo 邮件转发。":
    {
      tw: "已撤銷 {name} 的{title}身份，但{emailProblem}。請你自己告訴他：還在收款的活動錢繼續付到他的帳戶，收到後和你核對；之後可以刪掉 Venmo 郵件轉發。",
      en: "Removed {name}'s {title} role, but {emailProblem}. Please tell them yourself: payments for events still collecting keep going to their account, so check with them once they arrive; after that they can delete the Venmo email forwarding.",
    },
  "管理员和组织者（{n}）": { tw: "管理員和組織者（{n}）", en: "Admins and organizers ({n})" },
  "组织者（{n}）": { tw: "組織者（{n}）", en: "Organizers ({n})" },
  "还没有组织者。在下面的成员列表点「设为组织者」。": {
    tw: "還沒有組織者。在下面的成員列表點「設為組織者」。",
    en: 'No organizers yet. Tap "Make organizer" in the member list below.',
  },
  还没有组织者: { tw: "還沒有組織者", en: "No organizers yet" },
  "{time} 任命 · ": { tw: "{time} 任命 · ", en: "Appointed {time} · " },
  收款设置已填好: { tw: "收款設定已填好", en: "Payment settings done" },
  收款设置没填好: { tw: "收款設定沒填好", en: "Payment settings not done" },
  "{time} 之后没收到 Venmo 邮件，但有 {n} 笔欠款，转发可能中断": {
    tw: "{time} 之後沒收到 Venmo 郵件，但有 {n} 筆欠款，轉發可能中斷",
    en: "No Venmo email since {time}, but {n} bill(s) are unpaid; forwarding may be broken",
  },
  "没收到 Venmo 邮件，但有 {n} 笔欠款，转发可能中断": {
    tw: "沒收到 Venmo 郵件，但有 {n} 筆欠款，轉發可能中斷",
    en: "No Venmo email received, but {n} bill(s) are unpaid; forwarding may be broken",
  },
  "转发已生效（{time}）": { tw: "轉發已生效（{time}）", en: "Forwarding works ({time})" },
  "还没收到 Venmo 邮件": { tw: "還沒收到 Venmo 郵件", en: "No Venmo email received yet" },
  "Telegram 已连接": { tw: "Telegram 已連線", en: "Telegram connected" },
  "Telegram 未连接": { tw: "Telegram 未連線", en: "Telegram not connected" },
  " · 负责 {events} 场未归档活动": { tw: " · 負責 {events} 場未歸檔活動", en: " · runs {events} unarchived event(s)" },
  撤销: { tw: "撤銷", en: "Remove" },
  "已撤销，还有 {n} 场在收款": { tw: "已撤銷，還有 {n} 場在收款", en: "Removed; {n} event(s) still collecting" },
  "＋ 新建活动": { tw: "＋ 新建活動", en: "＋ New event" },
  负责人: { tw: "負責人", en: "Run by" },
  所有负责人: { tw: "所有負責人", en: "Everyone" },
  "群主（{name}）": { tw: "群主（{name}）", en: "Owner ({name})" },
  "{name}（已卸任）": { tw: "{name}（已卸任）", en: "{name} (stepped down)" },
  进行中: { tw: "進行中", en: "Current" },
  没有进行中的活动: { tw: "沒有進行中的活動", en: "No current events" },
  已结束: { tw: "已結束", en: "Ended" },
  结算期限: { tw: "結算期限", en: "Settlement deadline" },
  "活动结束后，每半小时提醒负责人填写费用并点「结算费用」。": {
    tw: "活動結束後，每半小時提醒負責人填寫費用並點「結算費用」。",
    en: "After an event ends, whoever runs it is reminded every half hour to enter the fees and Finalize.",
  },
  "超过期限还没有结算，活动会自动归档：不出账单，不收费，以后也不能再结算。": {
    tw: "超過期限還沒有結算，活動會自動歸檔：不出帳單，不收費，以後也不能再結算。",
    en: "If it isn't finalized by the deadline, the event is archived by itself: no bills, no charge, and it can't be settled later.",
  },
  超过期限自动归档: { tw: "超過期限自動歸檔", en: "Archive when the deadline passes" },
  活动结束后几小时内必须结算: { tw: "活動結束後幾小時內必須結算", en: "Hours after the end to settle by" },
  "超过结算期限没有结算，已自动归档：没有出账单，不收费，不能再结算。": {
    tw: "超過結算期限沒有結算，已自動歸檔：沒有出帳單，不收費，不能再結算。",
    en: "Not finalized by the settlement deadline, so it was archived: no bills, no charge, and it can't be settled now.",
  },
  显示更早的活动: { tw: "顯示更早的活動", en: "Show older events" },
  "负责人：{name}": { tw: "負責人：{name}", en: "Run by: {name}" },
  新建活动: { tw: "新建活動", en: "New event" },
  我自己也报名: { tw: "我自己也報名", en: "Sign me up too" },
  创建后你会直接出现在报名名单里: {
    tw: "建立後你會直接出現在報名名單裡",
    en: "You'll be on the sign-up list as soon as it's created",
  },
  "标题（选填）": { tw: "標題（選填）", en: "Title (optional)" },
  "特别的活动可以起个名字，例如「HappyTuesday 比赛」；不填就只显示日期": {
    tw: "特別的活動可以起個名字，例如「HappyTuesday 比賽」；不填就只顯示日期",
    en: 'Name a special event, e.g. "HappyTuesday tournament"; leave blank to show just the date',
  },
  日期: { tw: "日期", en: "Date" },
  开始: { tw: "開始", en: "Start" },
  结束: { tw: "結束", en: "End" },
  报名截止时间: { tw: "報名截止時間", en: "Sign-up deadline" },
  到截止时间就不能再报名: { tw: "到截止時間就不能再報名", en: "No sign-ups after the deadline" },
  "不设截止：活动结束前都能报名（结算后就不能了）": {
    tw: "不設截止：活動結束前都能報名（結算後就不能了）",
    en: "No deadline: people can sign up until the event ends (not after Finalize)",
  },
  活动开始前: { tw: "活動開始前", en: "Before the event starts" },
  "{n} 天": { tw: "{n} 天", en: "{n} days" },
  "{n} 小时": { tw: "{n} 小時", en: "{n} hours" },
  创建活动: { tw: "建立活動", en: "Create event" },
  排队系统: { tw: "排隊系統", en: "Court queue" },
  每轮多少分钟: { tw: "每輪多少分鐘", en: "Minutes per round" },
  "用来估算排队的组大约多久上场，{QUEUE_ROUND_MIN}–{QUEUE_ROUND_MAX} 分钟": {
    tw: "用來估算排隊的組大約多久上場，{QUEUE_ROUND_MIN}–{QUEUE_ROUND_MAX} 分鐘",
    en: "Used to estimate when queued groups get on court, {QUEUE_ROUND_MIN}–{QUEUE_ROUND_MAX} minutes",
  },
  "备注（选填）": { tw: "備註（選填）", en: "Notes (optional)" },
  最近的场馆: { tw: "最近的場館", en: "Recent venues" },
  "从最近的场馆中删除「{name}」": { tw: "從最近的場館中刪除「{name}」", en: 'Remove "{name}" from recent venues' },
  场馆: { tw: "場館", en: "Venue" },
  "‹ 所有活动": { tw: "‹ 所有活動", en: "‹ All events" },
  代为添加: { tw: "代為新增", en: "Added for them" },
  群主添加: { tw: "群主新增", en: "Added by owner" },
  "取消后这次活动不产生费用，也不计入统计。确定取消吗？": {
    tw: "取消後這次活動不產生費用，也不計入統計。確定取消嗎？",
    en: "Cancelling means this event costs nothing and isn't counted in stats. Cancel it?",
  },
  "从名单中删除「{name}」？": { tw: "從名單中刪除「{name}」？", en: 'Remove "{name}" from the list?' },
  "朋友的名字（留空则显示为默认名字）": {
    tw: "朋友的名字（留空則顯示為預設名字）",
    en: "Friend's name (leave blank for the default name)",
  },
  复制活动链接: { tw: "複製活動連結", en: "Copy event link" },
  "名单（{n}）": { tw: "名單（{n}）", en: "Sign-ups ({n})" },
  还没有人报名: { tw: "還沒有人報名", en: "No one has signed up yet" },
  "{name} 带的朋友": { tw: "{name} 帶的朋友", en: "{name}'s friend" },
  "{name} 带的群友，{name} 付钱": { tw: "{name} 帶的群友，{name} 付錢", en: "Member brought by {name}; {name} pays" },
  到场: { tw: "到場", en: "Attended" },
  改名: { tw: "改名", en: "Rename" },
  取消这次活动: { tw: "取消這次活動", en: "Cancel this event" },
  拍照登记用量: { tw: "拍照登記用量", en: "Photo check-in usage" },
  张照片: { tw: "張照片", en: "photos" },
  "估价（不全）": { tw: "估價（不全）", en: "Estimate (partial)" },
  估价: { tw: "估價", en: "Estimate" },
  备用: { tw: "備用", en: "Fallback" },
  "{n} 张": { tw: "{n} 張", en: "{n} photos" },
  "{input} 入 / {output} 出": { tw: "{input} 入 / {output} 出", en: "{input} in / {output} out" },
  "其中 {failed} 张识别失败（也计入用量）。": {
    tw: "其中 {failed} 張識別失敗（也計入用量）。",
    en: "{failed} of them failed to read (still counted in usage).",
  },
  "按 Anthropic 公开价估算：{prices}。": {
    tw: "按 Anthropic 公開價估算：{prices}。",
    en: "Estimated at Anthropic's public prices: {prices}.",
  },
  "{name} 每百万 token 输入 {input}、输出 {output}": {
    tw: "{name} 每百萬 token 輸入 {input}、輸出 {output}",
    en: "{name}: input {input}, output {output} per million tokens",
  },
  "；": { tw: "；", en: "; " },
  "{models} 没有价格，只算了 token。": {
    tw: "{models} 沒有價格，只算了 token。",
    en: "{models} have no price; only tokens are counted.",
  },
  "、": { tw: "、", en: ", " },
  "实际账单以 Azure 为准。": { tw: "實際帳單以 Azure 為準。", en: "Azure's bill is the final word." },
  操作记录: { tw: "操作記錄", en: "Change log" },
  "账单已经发出，收款人仍是 {name}，只换负责人。": {
    tw: "帳單已經發出，收款人仍是 {name}，只換負責人。",
    en: "Bills have already gone out, so the payee stays {name}; only the manager changes.",
  },
  "收款人也一起换成 {label}，结算后成员把钱付给他（{payee}本人和挂在名下的朋友也要付）。": {
    tw: "收款人也一起換成 {label}，結算後成員把錢付給他（{payee}本人和掛在名下的朋友也要付）。",
    en: "The payee also changes to {label}: once billed, members pay them ({payee} and the friends under them pay too).",
  },
  "{label} 还没填好收款设置，填好之前这场不能结算。": {
    tw: "{label} 還沒填好收款設定，填好之前這場不能結算。",
    en: "{label} hasn't finished their payment settings; this event can't be billed until they do.",
  },
  "把这场活动转给 {label}？\n\n{money}": {
    tw: "把這場活動轉給 {label}？\n\n{money}",
    en: "Hand this event over to {label}?\n\n{money}",
  },
  "负责人：{manager} · 收款人：{payee}": {
    tw: "負責人：{manager} · 收款人：{payee}",
    en: "Manager: {manager} · Payee: {payee}",
  },
  转给: { tw: "轉給", en: "Hand over to" },
  选择一位组织者或群主: { tw: "選擇一位組織者或群主", en: "Choose an organizer or the owner" },
  "已经结算：只换负责人，钱仍然付给原来的收款人，直到收齐。": {
    tw: "已經結算：只換負責人，錢仍然付給原來的收款人，直到收齊。",
    en: "Already billed: only the manager changes; payments still go to the original payee until everyone has paid.",
  },
  "还没结算：负责人和收款人一起换。": {
    tw: "還沒結算：負責人和收款人一起換。",
    en: "Not billed yet: the manager and payee change together.",
  },
  转交: { tw: "轉交", en: "Hand over" },
  "最后确认：永久删除 {label} 这次活动？删除后无法恢复。": {
    tw: "最後確認：永久刪除 {label} 這次活動？刪除後無法恢復。",
    en: "Final check: permanently delete {label}? This can't be undone.",
  },
  危险操作: { tw: "危險操作", en: "Danger zone" },
  "比如测试用的活动。只有已收齐归档或已取消的活动可以删除。删除后不再计入排行榜、成员花费和 Google Sheets 同步。": {
    tw: "比如測試用的活動。只有已收齊歸檔或已取消的活動可以刪除。刪除後不再計入排行榜、成員花費和 Google Sheets 同步。",
    en: "For example, test events. Only archived (fully paid) or cancelled events can be deleted. Once deleted, it no longer counts toward leaderboards, member spending or Google Sheets sync.",
  },
  从数据库永久删除: { tw: "從資料庫永久刪除", en: "Permanently delete from the database" },
  "这次活动的报名名单、账单、付款记录和匹配到的 Venmo 收款都会被一并删除，无法恢复。": {
    tw: "這次活動的報名名單、帳單、付款記錄和匹配到的 Venmo 收款都會被一併刪除，無法恢復。",
    en: "The event's sign-up list, bills, payment records and matched Venmo payments will all be deleted. This can't be undone.",
  },
  永久删除: { tw: "永久刪除", en: "Delete permanently" },
  的朋友: { tw: "的朋友", en: "'s friend " },
  "取消你自己和带的 {n} 个朋友的报名？": {
    tw: "取消你自己和帶的 {n} 個朋友的報名？",
    en: "Cancel your sign-up and your {n} friend(s)?",
  },
  "取消你自己的报名？": { tw: "取消你自己的報名？", en: "Cancel your sign-up?" },
  "✓ {broughtBy} 带你报名，费用由 {broughtBy} 付": {
    tw: "✓ {broughtBy} 帶你報名，費用由 {broughtBy} 付",
    en: "✓ {broughtBy} signed you up; {broughtBy} pays",
  },
  "✓ 你已报名，带 {n} 个朋友（{names}）": {
    tw: "✓ 你已報名，帶 {n} 個朋友（{names}）",
    en: "✓ You're signed up, with {n} friend(s) ({names})",
  },
  "✓ 你已报名": { tw: "✓ 你已報名", en: "✓ You're signed up" },
  "你没有报名，但名单上有你带的 {n} 个朋友": {
    tw: "你沒有報名，但名單上有你帶的 {n} 個朋友",
    en: "You're not signed up, but {n} of your friends are on the list",
  },
  你还没有报名: { tw: "你還沒有報名", en: "You haven't signed up" },
  我的报名: { tw: "我的報名", en: "My sign-up" },
  "场地编号请填 1–{BOOKED_COURT_MAX}": {
    tw: "場地編號請填 1–{BOOKED_COURT_MAX}",
    en: "Court numbers must be 1–{BOOKED_COURT_MAX}",
  },
  预定场地: { tw: "預定場地", en: "Booked courts" },
  "{n} 号": { tw: "{n} 號", en: "Court {n}" },
  "去掉 {n} 号": { tw: "去掉 {n} 號", en: "Remove court {n}" },
  还没有填场地: { tw: "還沒有填場地", en: "No courts yet" },
  添加场地: { tw: "新增場地", en: "Add court" },
  "选择或输入 1–{BOOKED_COURT_MAX}": { tw: "選擇或輸入 1–{BOOKED_COURT_MAX}", en: "Pick or type 1–{BOOKED_COURT_MAX}" },
  选择场地: { tw: "選擇場地", en: "Choose courts" },
  "添加 {n} 号": { tw: "新增 {n} 號", en: "Add court {n}" },
  "最多 {n} 块场地": { tw: "最多 {n} 塊場地", en: "At most {n} courts" },
  保存场地: { tw: "儲存場地", en: "Save courts" },
  重新开放报名: { tw: "重新開放報名", en: "Reopen sign-up" },
  截止日期: { tw: "截止日期", en: "Closing date" },
  截止时间: { tw: "截止時間", en: "Closing time" },
  重新开放: { tw: "重新開放", en: "Reopen" },
  添加人员: { tw: "新增人員", en: "Add people" },
  请选择: { tw: "請選擇", en: "Choose" },
  这个成员本人也来: { tw: "這個成員本人也來", en: "This member is coming too" },
  挂在他名下的朋友: { tw: "掛在他名下的朋友", en: "Friends under them" },
  "立即截止后，成员不能再报名或修改。之后如有需要可以重新开放。确定吗？": {
    tw: "立即截止後，成員不能再報名或修改。之後如有需要可以重新開放。確定嗎？",
    en: "Once closed, members can't sign up or make changes. You can reopen it later if needed. Close now?",
  },
  立即截止报名: { tw: "立即截止報名", en: "Close sign-up now" },
  "修改活动标题、时间、地点、备注或排队系统": {
    tw: "修改活動標題、時間、地點、備註或排隊系統",
    en: "Edit the event's title, time, place, notes or court queue",
  },
  "修改会立即显示在活动页和成员页，但不会自动通知任何人，请自己在群里说明。活动代号和已发出的链接不变。确定修改吗？": {
    tw: "修改會立即顯示在活動頁和成員頁，但不會自動通知任何人，請自己在群裡說明。活動代號和已發出的連結不變。確定修改嗎？",
    en: "Changes show on the event and member pages right away, but no one is notified; please tell the group yourself. The event code and links already sent stay the same. Save changes?",
  },
  "修改活动（紧急情况）": { tw: "修改活動（緊急情況）", en: "Edit event (emergencies)" },
  "只在场地变更、时间临时调整等紧急情况使用。修改后请在微信群里通知大家。": {
    tw: "只在場地變更、時間臨時調整等緊急情況使用。修改後請在微信群裡通知大家。",
    en: "Only for emergencies such as a venue change or a last-minute time change. Let everyone know in the WeChat group afterwards.",
  },
  结算: { tw: "結算", en: "Settle" },
  应付款: { tw: "應付款", en: "Amounts due" },
  付款明细: { tw: "付款明細", en: "Payment details" },
  待确认收款: { tw: "待確認收款", en: "Payments to confirm" },
  导出数据: { tw: "匯出資料", en: "Export data" },
  "金额为美元，时间为太平洋时间。": {
    tw: "金額為美元，時間為太平洋時間。",
    en: "Amounts are in US dollars; times are Pacific time.",
  },
  "重新生成后，旧脚本立即失效，需要把新脚本粘贴到 Google 表格里。继续吗？": {
    tw: "重新生成後，舊腳本立即失效，需要把新腳本貼上到 Google 表格裡。繼續嗎？",
    en: "After regenerating, the old script stops working right away and the new one needs to be pasted into Google Sheets. Continue?",
  },
  "关闭后，Google 表格将无法再同步（表格里已有的数据保留）。继续吗？": {
    tw: "關閉後，Google 表格將無法再同步（表格裡已有的資料保留）。繼續嗎？",
    en: "After turning it off, Google Sheets can no longer sync (data already in the sheet stays). Continue?",
  },
  "Google 表格同步": { tw: "Google 表格同步", en: "Google Sheets sync" },
  "没有开启。": { tw: "沒有開啟。", en: "Off." },
  "✓ 已开启，上次同步：{fmtInstant}": { tw: "✓ 已開啟，上次同步：{fmtInstant}", en: "✓ On, last synced {fmtInstant}" },
  "已开启，还没有同步过。": { tw: "已開啟，還沒有同步過。", en: "On, not synced yet." },
  "网站密钥换过，需要群主重新生成同步脚本。": {
    tw: "網站金鑰換過，需要群主重新生成同步腳本。",
    en: "The site key changed; the owner needs to regenerate the sync script.",
  },
  "开启、关闭同步和查看脚本只有群主能做。": {
    tw: "開啟、關閉同步和查看腳本只有群主能做。",
    en: "Only the owner can turn sync on or off and see the script.",
  },
  "每天自动把所有数据（活动、报名、结算、付款、成员等）复制一份到你自己的 Google 表格，作为备份和存档。网站不需要你的 Google 账号；表格只读取，不会改动网站的数据。":
    {
      tw: "每天自動把所有資料（活動、報名、結算、付款、成員等）複製一份到你自己的 Google 表格，作為備份和存檔。網站不需要你的 Google 帳號；表格只讀取，不會改動網站的資料。",
      en: "Every day, copies all data (events, sign-ups, settlements, payments, members and more) to your own Google Sheet as a backup and archive. The site never needs your Google account; the sheet only reads and never changes the site's data.",
    },
  开启同步: { tw: "開啟同步", en: "Turn on sync" },
  "网站密钥换过，同步脚本已无法显示。请点下面的「重新生成密钥」，再把新脚本粘贴到 Google 表格里（旧脚本在那之前还能继续同步）。":
    {
      tw: "網站金鑰換過，同步腳本已無法顯示。請點下面的「重新生成金鑰」，再把新腳本貼上到 Google 表格裡（舊腳本在那之前還能繼續同步）。",
      en: 'The site key changed, so the sync script can\'t be shown. Tap "Regenerate key" below and paste the new script into Google Sheets (the old script keeps syncing until then).',
    },
  "✓ 上次同步：{fmtInstant}": { tw: "✓ 上次同步：{fmtInstant}", en: "✓ Last synced {fmtInstant}" },
  "还没有同步过。按下面的步骤设置好后会自动同步。": {
    tw: "還沒有同步過。按下面的步驟設定好後會自動同步。",
    en: "Not synced yet. It syncs automatically once you've followed the steps below.",
  },
  "新建一个 Google 表格（sheets.new）。": {
    tw: "新建一個 Google 表格（sheets.new）。",
    en: "Create a new Google Sheet (sheets.new).",
  },
  "菜单「扩展程序」→「Apps Script」，删掉里面原有的内容。": {
    tw: "選單「擴充功能」→「Apps Script」，刪掉裡面原有的內容。",
    en: 'Menu "Extensions" → "Apps Script", and delete what\'s already there.',
  },
  "复制下面的脚本，粘贴进去，点保存。": {
    tw: "複製下面的腳本，貼上進去，點儲存。",
    en: "Copy the script below, paste it in, and save.",
  },
  "在顶部选择函数 {code}，点「运行」，按提示授权。看到「Google 尚未验证此应用」时，点「高级」→「转到…（不安全）」→「允许」。":
    {
      tw: "在頂部選擇函式 {code}，點「執行」，按提示授權。看到「Google 尚未驗證此應用」時，點「進階」→「轉到…（不安全）」→「允許」。",
      en: 'At the top, choose the function {code}, click "Run" and authorize when asked. When you see "Google hasn\'t verified this app", click "Advanced" → "Go to … (unsafe)" → "Allow".',
    },
  "完成后表格里会出现各个标签页，以后每天凌晨 3 点自动更新。": {
    tw: "完成後表格裡會出現各個標籤頁，以後每天凌晨 3 點自動更新。",
    en: "The sheet then gets its tabs and updates automatically at 3 a.m. every day.",
  },
  复制脚本: { tw: "複製腳本", en: "Copy script" },
  "脚本里含有同步密钥，请不要发给别人。万一泄露，点「重新生成密钥」后粘贴新脚本即可。": {
    tw: "腳本裡含有同步金鑰，請不要發給別人。萬一洩露，點「重新生成金鑰」後貼上新腳本即可。",
    en: 'The script contains the sync key; don\'t send it to anyone. If it leaks, tap "Regenerate key" and paste the new script.',
  },
  重新生成密钥: { tw: "重新生成金鑰", en: "Regenerate key" },
  关闭同步: { tw: "關閉同步", en: "Turn off sync" },
  可选: { tw: "可選", en: "Optional" },
  "Venmo App →「Settings → Notifications」，确认收款（You receive a payment）的{b}是打开的。": {
    tw: "Venmo App →「Settings → Notifications」，確認收款（You receive a payment）的{b}是開啟的。",
    en: 'In the Venmo app → "Settings → Notifications", make sure {b} for "You receive a payment" is on.',
  },
  邮件通知: { tw: "郵件通知", en: "email notifications" },
  "电脑上打开 Gmail →「设置 ⚙ → 查看所有设置 → 转发和 POP/IMAP → 添加转发地址」，填：": {
    tw: "電腦上開啟 Gmail →「設定 ⚙ → 查看所有設定 → 轉寄和 POP/IMAP → 新增轉寄地址」，填：",
    en: 'On a computer, open Gmail → "Settings ⚙ → See all settings → Forwarding and POP/IMAP → Add a forwarding address" and enter:',
  },
  "回到 Gmail，在搜索框输入 {code} → 点搜索框右边的「显示搜索选项」→「创建过滤器」→ 勾选「转发到」并选择上面的地址（建议同时加一个「Venmo」标签，{b}勾删除）→ 创建过滤器。":
    {
      tw: "回到 Gmail，在搜尋框輸入 {code} → 點搜尋框右邊的「顯示搜尋選項」→「建立篩選器」→ 勾選「轉寄到」並選擇上面的地址（建議同時加一個「Venmo」標籤，{b}勾刪除）→ 建立篩選器。",
      en: 'Back in Gmail, type {code} in the search box → click "Show search options" at the right of the search box → "Create filter" → check "Forward it to" and choose the address above (we suggest adding a "Venmo" label too, and {b} check delete) → Create filter.',
    },
  不要: { tw: "不要", en: "don't" },
  "Venmo 通知邮箱不是 Gmail 的话（例如 Outlook），在那个邮箱里设一条规则，把 venmo@venmo.com 发来的邮件自动转发到上面的地址。":
    {
      tw: "Venmo 通知電子郵件不是 Gmail 的話（例如 Outlook），在那個電子郵件裡設一條規則，把 venmo@venmo.com 發來的郵件自動轉發到上面的地址。",
      en: "If your Venmo notification email isn't Gmail (Outlook, for example), set up a rule there that forwards mail from venmo@venmo.com to the address above.",
    },
  "{b}：请朋友用 Venmo 付你 $1（备注随便写，之后退回），过一两分钟刷新本页，看下面的「转发状态」。": {
    tw: "{b}：請朋友用 Venmo 付你 $1（備註隨便寫，之後退回），過一兩分鐘重新整理本頁，看下面的「轉發狀態」。",
    en: '{b}: ask a friend to Venmo you $1 (any note; refund it later), wait a minute or two, refresh this page and check "Forwarding status" below.',
  },
  测试: { tw: "測試", en: "Test" },
  使用指南: { tw: "使用指南", en: "User guide" },
  "一、第一次设置后要做的事": { tw: "一、第一次設定後要做的事", en: "1. To do after first-time setup" },
  "{b}。打开管理页需要「管理链接 + 群主密码」两样。如果是用初始密码登录的，请在「设置 → 账号与安全 → 修改群主密码」里改成你自己的。":
    {
      tw: "{b}。開啟管理頁需要「管理連結 + 群主密碼」兩樣。如果是用初始密碼登入的，請在「設定 → 帳號與安全 → 修改群主密碼」裡改成你自己的。",
      en: '{b}. Opening the admin page takes both the admin link and the owner password. If you signed in with the initial password, change it to your own under "Settings → Account & security → Change owner password".',
    },
  收藏管理链接: { tw: "收藏管理連結", en: "Bookmark the admin link" },
  "{b}（「设置 → 高级设置 → Telegram 通知」→ 连接，然后发送测试消息）。所有提醒、账单提醒、收款异常都发到这里{x}；以后忘了管理链接也能在这里找回。":
    {
      tw: "{b}（「設定 → 進階設定 → Telegram 通知」→ 連線，然後傳送測試訊息）。所有提醒、帳單提醒、收款異常都發到這裡{x}；以後忘了管理連結也能在這裡找回。",
      en: '{b} ("Settings → Advanced → Telegram notifications" → connect, then send a test message). All reminders, bill reminders and payment problems come here{x}; if you forget the admin link you can get it back here too.',
    },
  "连接 Telegram": { tw: "連線 Telegram", en: "Connect Telegram" },
  "（组织者负责的活动的提醒发给组织者，见第四部分）": {
    tw: "（組織者負責的活動的提醒發給組織者，見第四部分）",
    en: " (reminders for events run by organizers go to the organizers; see part 4)",
  },
  "{b}（「设置 → 账号与安全 → 备份网站密钥」，要先连接 Telegram）：密钥发到 Telegram 后存进密码管理器，再交给网站维护者存成 GitHub secret。万一 Cloudflare 里的密钥丢了，部署时会用它自动恢复，成员链接、管理链接和表格同步脚本才能继续显示和找回。":
    {
      tw: "{b}（「設定 → 帳號與安全 → 備份網站金鑰」，要先連線 Telegram）：金鑰發到 Telegram 後存進密碼管理器，再交給網站維護者存成 GitHub secret。萬一 Cloudflare 裡的金鑰丟了，部署時會用它自動恢復，成員連結、管理連結和表格同步腳本才能繼續顯示和找回。",
      en: '{b} ("Settings → Account & security → Back up site key"; connect Telegram first): the key is sent to Telegram; save it in a password manager, then give it to the site maintainer to store as a GitHub secret. If the key in Cloudflare is ever lost, deploys restore it automatically, so member links, the admin link and the sheet sync script keep working.',
    },
  备份网站密钥: { tw: "備份網站金鑰", en: "Back up the site key" },
  "{b}（「设置 → 收款设置」，保存时要输入群主密码）：Venmo 用户名、Venmo 通知邮箱（Venmo 账户里登记的、收款通知发到的那个邮箱），Zelle 选填。":
    {
      tw: "{b}（「設定 → 收款設定」，儲存時要輸入群主密碼）：Venmo 使用者名稱、Venmo 通知電子郵件（Venmo 帳戶裡登記的、收款通知發到的那個電子郵件），Zelle 選填。",
      en: '{b} ("Settings → Payment settings"; saving asks for the owner password): Venmo username, Venmo notification email (the email on your Venmo account that payment notices go to); Zelle is optional.',
    },
  填写收款设置: { tw: "填寫收款設定", en: "Fill in payment settings" },
  "{b}，让系统自动对账，见下面第二部分。": {
    tw: "{b}，讓系統自動對帳，見下面第二部分。",
    en: "{b} so payments are matched automatically; see part 2 below.",
  },
  "设置 Venmo 邮件转发": { tw: "設定 Venmo 郵件轉發", en: "Set up Venmo email forwarding" },
  "{b}（「设置 → 高级设置」和「设置 → 收款设置」）：截止前几小时提醒、每天几点发账单提醒。": {
    tw: "{b}（「設定 → 進階設定」和「設定 → 收款設定」）：截止前幾小時提醒、每天幾點發帳單提醒。",
    en: '{b} ("Settings → Advanced" and "Settings → Payment settings"): the reminder a few hours before sign-up closes, and what time bill reminders go out each day.',
  },
  检查提醒设置: { tw: "檢查提醒設定", en: "Check reminder settings" },
  "{b}（「设置 → 高级设置 → Google 表格同步」）：每天把数据备份到你自己的 Google 表格。": {
    tw: "{b}（「設定 → 進階設定 → Google 表格同步」）：每天把資料備份到你自己的 Google 表格。",
    en: '{b} ("Settings → Advanced → Google Sheets sync"): back up the data to your own Google Sheet every day.',
  },
  "{b}（「设置 → 外观和公共页面」）：网站标题和配色。": {
    tw: "{b}（「設定 → 外觀和公共頁面」）：網站標題和配色。",
    en: '{b} ("Settings → Look & public page"): site title and colors.',
  },
  "{b}：把网站首页发到微信群，大家点「登录 / 注册」，用 Google 账号申请（新成员只能用 Google）。在「待审核」里通过后，对方直接用 Google 登录就能报名。":
    {
      tw: "{b}：把網站首頁發到微信群，大家點「登入 / 註冊」，用 Google 帳號申請（新成員只能用 Google）。在「待審核」裡通過後，對方直接用 Google 登入就能報名。",
      en: '{b}: post the home page in the WeChat group; people tap "Sign in / Join" and apply with a Google account (new members can only use Google). Once you approve them under "Pending", they sign in with Google and can sign up.',
    },
  邀请成员: { tw: "邀請成員", en: "Invite members" },
  "{b}：在「活动」里新建，然后点「复制活动链接」发到群里。": {
    tw: "{b}：在「活動」裡新建，然後點「複製活動連結」發到群裡。",
    en: '{b}: create one under "Events", then tap "Copy event link" and post it in the group.',
  },
  "二、Venmo 收款邮件转发：设置与测试": {
    tw: "二、Venmo 收款郵件轉發：設定與測試",
    en: "2. Venmo payment email forwarding: setup and testing",
  },
  "系统读取 Venmo 发来的收款通知邮件，按备注里的付款编号自动记账。你的邮箱密码系统拿不到，只是用 Gmail 把 Venmo 的邮件转发过来；和羽毛球无关的收款会被忽略，不会保存。":
    {
      tw: "系統讀取 Venmo 發來的收款通知郵件，按備註裡的付款編號自動記帳。你的電子郵件密碼系統拿不到，只是用 Gmail 把 Venmo 的郵件轉發過來；和羽毛球無關的收款會被忽略，不會儲存。",
      en: "The site reads Venmo's payment notification emails and records payments by the payment code in the note. It never gets your email password; Gmail just forwards Venmo's emails. Payments unrelated to badminton are ignored and not saved.",
    },
  "Gmail 会往这个地址发一封确认邮件，系统会把它{b}（需要先连接 Telegram）。把里面的确认码填回 Gmail，或打开里面的确认链接。":
    {
      tw: "Gmail 會往這個地址發一封確認郵件，系統會把它{b}（需要先連線 Telegram）。把裡面的確認碼填回 Gmail，或開啟裡面的確認連結。",
      en: "Gmail sends a confirmation email to this address, and the site {b} (connect Telegram first). Enter the confirmation code back in Gmail, or open the confirmation link in it.",
    },
  "转到你的 Telegram": { tw: "轉到你的 Telegram", en: "forwards it to your Telegram" },
  "转发状态：": { tw: "轉發狀態：", en: "Forwarding status: " },
  "{time} 收到 —— {outcome}": { tw: "{time} 收到 —— {outcome}", en: "{time} received: {outcome}" },
  还没有收到过邮件: { tw: "還沒有收到過郵件", en: "No email received yet" },
  "成员付款时，备注里要带他专属页面上显示的付款编号（例如 xiaoming-jbm20261007-m002），系统才能自动记到他的账上。对不上的会进入「收款 → 待确认」，由你手动关联。":
    {
      tw: "成員付款時，備註裡要帶他專屬頁面上顯示的付款編號（例如 xiaoming-jbm20261007-m002），系統才能自動記到他的帳上。對不上的會進入「收款 → 待確認」，由你手動關聯。",
      en: "When members pay, the note must include the payment code shown on their personal page (e.g. xiaoming-jbm20261007-m002) so it's recorded to them automatically. Anything that doesn't match goes to \"Payments → To confirm\" for you to match by hand.",
    },
  "三、忘记密码或管理链接怎么办": { tw: "三、忘記密碼或管理連結怎麼辦", en: "3. Forgot the password or admin link" },
  "{b}：在 Telegram 里给机器人发送「管理页面」，它会把链接发给你（只回复已连接的那个账号）。没连 Telegram 的话，请网站维护者在 GitHub → Actions → CI → Run workflow，「Use workflow from」选最新的版本标签（v 开头），勾选 reset_admin_link 运行一次（测试环境则选 main），然后打开 {code} {x}":
    {
      tw: "{b}：在 Telegram 裡給機器人傳送「管理頁面」，它會把連結發給你（只回覆已連線的那個帳號）。沒連 Telegram 的話，請網站維護者在 GitHub → Actions → CI → Run workflow，「Use workflow from」選最新的版本標籤（v 開頭），勾選 reset_admin_link 執行一次（測試環境則選 main），然後開啟 {code} {x}",
      en: '{b}: send "admin" to the bot in Telegram and it sends you the link (it only answers the connected account). Without Telegram, ask the site maintainer to go to GitHub → Actions → CI → Run workflow, choose the latest version tag (starting with v) under "Use workflow from", check reset_admin_link and run it once (choose main for the test site), then open {code} {x}',
    },
  忘记管理链接: { tw: "忘記管理連結", en: "Forgot the admin link" },
  "用当前的群主密码重新生成（没在管理页改过密码的话，就是 GitHub 里的 ADMIN_PASSWORD，测试环境是 ADMIN_PASSWORD_STAGING）。":
    {
      tw: "用當前的群主密碼重新生成（沒在管理頁改過密碼的話，就是 GitHub 裡的 ADMIN_PASSWORD，測試環境是 ADMIN_PASSWORD_STAGING）。",
      en: "and create a new one with the current owner password (if it was never changed on the admin page, it's ADMIN_PASSWORD on GitHub, or ADMIN_PASSWORD_STAGING for the test site).",
    },
  "{b}：网站维护者把 GitHub 仓库里的 ADMIN_PASSWORD 改成一个新密码，然后在 Actions → CI → Run workflow 运行一次（「Use workflow from」选最新的版本标签，v 开头）。部署完成后用新密码登录，再到这里改成你自己的密码。所有设备会被退出登录。":
    {
      tw: "{b}：網站維護者把 GitHub 倉庫裡的 ADMIN_PASSWORD 改成一個新密碼，然後在 Actions → CI → Run workflow 執行一次（「Use workflow from」選最新的版本標籤，v 開頭）。部署完成後用新密碼登入，再到這裡改成你自己的密碼。所有裝置會被退出登入。",
      en: '{b}: the site maintainer changes ADMIN_PASSWORD in the GitHub repository to a new password, then runs Actions → CI → Run workflow once (choose the latest version tag, starting with v, under "Use workflow from"). After the deploy, sign in with the new password, then change it to your own here. All devices are signed out.',
    },
  忘记密码: { tw: "忘記密碼", en: "Forgot the password" },
  "{b}：用管理链接打开，输入密码即可；每台设备记住登录 30 天。": {
    tw: "{b}：用管理連結開啟，輸入密碼即可；每臺裝置記住登入 30 天。",
    en: "{b}: open the admin link and enter the password; each device stays signed in for 30 days.",
  },
  换一部手机: { tw: "換一部手機", en: "New phone" },
  "{b}：用「设置 → 账号与安全」里的「清空所有数据」重置网站，新群主用群主密码在 {code} 做初次设置，再按本指南走一遍。":
    {
      tw: "{b}：用「設定 → 帳號與安全」裡的「清空所有資料」重置網站，新群主用群主密碼在 {code} 做初次設定，再按本指南走一遍。",
      en: '{b}: reset the site with "Clear all data" under "Settings → Account & security"; the new owner then does first-time setup at {code} with the owner password and goes through this guide again.',
    },
  交接给新的群主: { tw: "交接給新的群主", en: "Handing over to a new owner" },
  "四、组织者": { tw: "四、組織者", en: "4. Organizers" },
  "{b}：在「成员」里点对方的「设为组织者」。对方要是正常状态的成员，并且已经关联了 Google 账号（组织者只能用 Google 账号进入管理页）。系统会发邮件告诉他；邮件服务没配置时页面会提示，你要自己告诉他。":
    {
      tw: "{b}：在「成員」裡點對方的「設為組織者」。對方要是正常狀態的成員，並且已經關聯了 Google 帳號（組織者只能用 Google 帳號進入管理頁）。系統會發郵件告訴他；郵件服務沒設定時頁面會提示，你要自己告訴他。",
      en: '{b}: tap "Make organizer" on their row under "Members". They must be an active member with a linked Google account (organizers can only reach the admin page with Google). We email them; if email isn\'t set up, the page tells you and you let them know yourself.',
    },
  任命: { tw: "任命", en: "Appointing" },
  "{b}（他的「设置」里有「给组织者的说明」）：填自己的收款设置（Venmo 用户名和通知邮箱，不填不能结算）、在自己的 Gmail 里设同样的 Venmo 邮件转发{x}。成员页最上面的「组织者」区块显示每个人做好了没有。":
    {
      tw: "{b}（他的「設定」裡有「給組織者的說明」）：填自己的收款設定（Venmo 使用者名稱和通知電子郵件，不填不能結算）、在自己的 Gmail 裡設同樣的 Venmo 郵件轉發{x}。成員頁最上面的「組織者」區塊顯示每個人做好了沒有。",
      en: '{b} (their "Settings" has "Notes for organizers"): fill in their own payment settings (Venmo username and notification email; they can\'t bill without them) and set up the same Venmo email forwarding in their own Gmail{x}. The "Organizers" box at the top of the members page shows who has finished.',
    },
  他要做的事: { tw: "他要做的事", en: "What they need to do" },
  "、连接自己的 Telegram": { tw: "、連線自己的 Telegram", en: ", and connect their own Telegram" },
  "{b}：他发起的活动（以及结算前转交给他的），成员把钱付到他的 Venmo，他自己的账单自动算已付；你去打他的球也要付钱给他。":
    {
      tw: "{b}：他發起的活動（以及結算前轉交給他的），成員把錢付到他的 Venmo，他自己的帳單自動算已付；你去打他的球也要付錢給他。",
      en: "{b}: for events they create (and ones handed to them before billing), members pay their Venmo, and their own bill counts as paid automatically. If you play at their event, you pay them too.",
    },
  钱进谁的账户: { tw: "錢進誰的帳戶", en: "Whose account the money goes to" },
  "{b}：他的活动的提醒发给他；他没连 Telegram 时改发给你，消息开头写明原因。你另外收到三条抄送：发起、结算完成、收齐。":
    {
      tw: "{b}：他的活動的提醒發給他；他沒連 Telegram 時改發給你，訊息開頭寫明原因。你另外收到三條抄送：發起、結算完成、收齊。",
      en: "{b}: reminders for their events go to them; if they haven't connected Telegram, they go to you, with the reason at the top. You also get three copies: created, billed, and fully paid.",
    },
  通知: { tw: "通知", en: "Notifications" },
  "{b}：只能管理自己负责的活动和进了自己账户的收款；「待审核」「成员」只读，看不到成员的专属链接。你能看到、也能修改他的活动，每场的「操作记录」里写着谁改了什么。":
    {
      tw: "{b}：只能管理自己負責的活動和進了自己帳戶的收款；「待審核」「成員」只讀，看不到成員的專屬連結。你能看到、也能修改他的活動，每場的「操作記錄」裡寫著誰改了什麼。",
      en: '{b}: they can only manage events they run and payments into their own account; "Pending" and "Members" are read-only, without members\' personal links. You can see and change their events; each event\'s "Change log" says who changed what.',
    },
  他能看到什么: { tw: "他能看到什麼", en: "What they can see" },
  "{b}：活动页的「转交」把活动交给另一位组织者或你自己；成员页的「撤销组织者」会先列出受影响的活动：还没结算的转给你，已经在收款的由你接手管理，钱继续付到他的账户直到收齐。":
    {
      tw: "{b}：活動頁的「轉交」把活動交給另一位組織者或你自己；成員頁的「撤銷組織者」會先列出受影響的活動：還沒結算的轉給你，已經在收款的由你接手管理，錢繼續付到他的帳戶直到收齊。",
      en: '{b}: "Hand over" on the event page gives the event to another organizer or to you. "Remove organizer" on the members page first lists the affected events: unbilled ones move to you; ones already collecting are managed by you, with payments still going to their account until everyone has paid.',
    },
  转交和撤销: { tw: "轉交和撤銷", en: "Handing over and removing" },
  "五、管理员": { tw: "五、管理員", en: "5. Admins" },
  "{b}：在「成员」里点「设为管理员」（组织者那一行是「升为管理员」，他原来的活动、收款设置和 Telegram 都保留）。条件和组织者一样：正常状态、已关联 Google。只有你能任命、降为组织者或撤销管理员。":
    {
      tw: "{b}：在「成員」裡點「設為管理員」（組織者那一行是「升為管理員」，他原來的活動、收款設定和 Telegram 都保留）。條件和組織者一樣：正常狀態、已關聯 Google。只有你能任命、降為組織者或撤銷管理員。",
      en: '{b}: tap "Make admin" under "Members" (on an organizer\'s row it\'s "Promote to admin"; their events, payment settings and Telegram stay). Same conditions as organizers: active, with Google linked. Only you can appoint admins, change them to organizers or remove them.',
    },
  "{b}：和你一样管理整个群：审核申请、管理成员、任命和撤销组织者、管理和转交所有活动、确认所有收款、修改群设置、导出数据、查看表格同步状态。他也能发起自己的活动，钱进他自己的 Venmo，和组织者一样要填收款设置、设 Gmail 转发。":
    {
      tw: "{b}：和你一樣管理整個群：審核申請、管理成員、任命和撤銷組織者、管理和轉交所有活動、確認所有收款、修改群設定、匯出資料、查看表格同步狀態。他也能發起自己的活動，錢進他自己的 Venmo，和組織者一樣要填收款設定、設 Gmail 轉發。",
      en: "{b}: run the whole group like you: review applications, manage members, appoint and remove organizers, manage and hand over all events, confirm all payments, change group settings, export data and check the sheet sync. They can also create their own events, with money going to their own Venmo; like organizers, they fill in payment settings and set up Gmail forwarding.",
    },
  他能做什么: { tw: "他能做什麼", en: "What they can do" },
  "{b}：任命和撤销管理员、群主密码和管理链接、备份密钥、清空数据、你自己的 Google 绑定和收款设置、表格同步的开关和脚本、付款诊断、永久删除活动和收款、删除成员。管理员也不能动你和其他管理员的成员记录（链接、停用）。":
    {
      tw: "{b}：任命和撤銷管理員、群主密碼和管理連結、備份金鑰、清空資料、你自己的 Google 綁定和收款設定、表格同步的開關和腳本、付款診斷、永久刪除活動和收款、刪除成員。管理員也不能動你和其他管理員的成員記錄（連結、停用）。",
      en: "{b}: appointing and removing admins, the owner password and admin link, backing up the key, clearing all data, your own Google link and payment settings, turning sheet sync on or off and its script, payment diagnostics, permanently deleting events and payments, and deleting members. Admins also can't touch your or other admins' member records (links, deactivating).",
    },
  只有你能做: { tw: "只有你能做", en: "Only you can" },
  "{b}：新成员申请发给你和每位连了 Telegram 的管理员；他的活动的发起、结算完成、收齐抄送给你。别人把你收款的活动转走时你会收到通知。":
    {
      tw: "{b}：新成員申請發給你和每位連了 Telegram 的管理員；他的活動的發起、結算完成、收齊抄送給你。別人把你收款的活動轉走時你會收到通知。",
      en: "{b}: new applications go to you and every admin with Telegram connected; you get copies when their events are created, billed and fully paid. You're notified when someone hands over an event you collect for.",
    },
  "{b}：成员页最下面的「群操作记录」写着谁通过了申请、停用了谁、任命了谁、改了什么设置、导出了什么。": {
    tw: "{b}：成員頁最下面的「群操作記錄」寫著誰通過了申請、停用了誰、任命了誰、改了什麼設定、匯出了什麼。",
    en: '{b}: the "Group activity log" at the bottom of the members page shows who approved applications, deactivated or appointed whom, changed which settings, and exported what.',
  },
  给管理员的说明: { tw: "給管理員的說明", en: "Notes for admins" },
  给组织者的说明: { tw: "給組織者的說明", en: "Notes for organizers" },
  "一、开始前要做的事": { tw: "一、開始前要做的事", en: "1. Before you start" },
  "{b}（设置里的「我的收款设置」）：Venmo 用户名、Venmo 通知邮箱（Venmo 账户里登记的、收款通知发到的那个邮箱），Zelle 选填。你负责的活动，成员把钱付到这里；没填好之前活动可以报名，但不能结算。":
    {
      tw: "{b}（設定裡的「我的收款設定」）：Venmo 使用者名稱、Venmo 通知電子郵件（Venmo 帳戶裡登記的、收款通知發到的那個電子郵件），Zelle 選填。你負責的活動，成員把錢付到這裡；沒填好之前活動可以報名，但不能結算。",
      en: "{b} (\"My payment settings\" in Settings): Venmo username, Venmo notification email (the email on your Venmo account that payment notices go to); Zelle is optional. Members pay here for events you run; until it's filled in, your events can take sign-ups but can't be billed.",
    },
  填好收款设置: { tw: "填好收款設定", en: "Fill in payment settings" },
  "{b}（设置里「Venmo 邮件转发」的步骤）：设好以后成员付款会自动记账；第一封 Venmo 收款邮件到了，转发状态会显示「已生效」。":
    {
      tw: "{b}（設定裡「Venmo 郵件轉發」的步驟）：設好以後成員付款會自動記帳；第一封 Venmo 收款郵件到了，轉發狀態會顯示「已生效」。",
      en: '{b} (the "Venmo email forwarding" steps in Settings): once set up, member payments are recorded automatically; when the first Venmo payment email arrives, the forwarding status shows "Working".',
    },
  "{b}（设置里的「我的 Telegram」）：你负责的活动的报名截止、结算和收款提醒会发给你；没连接时这些提醒发给群主。": {
    tw: "{b}（設定裡的「我的 Telegram」）：你負責的活動的報名截止、結算和收款提醒會發給你；沒連線時這些提醒發給群主。",
    en: '{b} ("My Telegram" in Settings): sign-up closing, billing and payment reminders for your events come to you; if you\'re not connected, they go to the owner.',
  },
  "连接你的 Telegram": { tw: "連線你的 Telegram", en: "Connect your Telegram" },
  "二、怎么组织一场活动": { tw: "二、怎麼組織一場活動", en: "2. How to run an event" },
  "在「活动」里点「＋ 新建活动」，你就是这场的负责人和收款人，然后「复制活动链接」发到群里。": {
    tw: "在「活動」裡點「＋ 新建活動」，你就是這場的負責人和收款人，然後「複製活動連結」發到群裡。",
    en: 'Under "Events", tap "＋ New event"; you\'re its manager and payee. Then tap "Copy event link" and post it in the group.',
  },
  "截止后可以改名单、标记到场，填好场地费和用球数，预览后点「结算费用」，成员就能看到账单并付钱给你。": {
    tw: "截止後可以改名單、標記到場，填好場地費和用球數，預覽後點「結算費用」，成員就能看到帳單並付錢給你。",
    en: "After sign-up closes, edit the list, mark attendance, enter the court fee and shuttlecocks used, preview and tap Finalize; members then see their bills and pay you.",
  },
  "没有自动对上的 Venmo 付款在「收款 › 待确认」里，关联到对应的账单；Zelle 和现金在活动的账单里手动标记已付。全部付清后活动自动归档。":
    {
      tw: "沒有自動對上的 Venmo 付款在「收款 › 待確認」裡，關聯到對應的帳單；Zelle 和現金在活動的帳單裡手動標記已付。全部付清後活動自動歸檔。",
      en: "Venmo payments that didn't match automatically are under \"Payments › To confirm\"; match them to the right bill. Mark Zelle and cash as paid by hand in the event's bills. Once everyone has paid, the event is archived automatically.",
    },
  "你还能像群主一样管理整个群：审核申请、管理成员、任命组织者、管理和转交所有活动、确认所有收款、修改群设置、导出数据。群主和管理员（包括你自己）的成员记录、任命管理员、密码和密钥、清空数据、永久删除只有群主能做。":
    {
      tw: "你還能像群主一樣管理整個群：審核申請、管理成員、任命組織者、管理和轉交所有活動、確認所有收款、修改群設定、匯出資料。群主和管理員（包括你自己）的成員記錄、任命管理員、密碼和金鑰、清空資料、永久刪除只有群主能做。",
      en: "You can also run the whole group like the owner: review applications, manage members, appoint organizers, manage and hand over all events, confirm all payments, change the group settings, and export data. Only the owner can change the owner's and admins' (including your own) member records, appoint admins, handle the password and keys, clear all data, and delete permanently.",
    },
  "群主能看到并修改你的活动，会收到发起、结算完成、收齐三条抄送。你看不到别人负责的活动和收款；「待审核」「成员」只能看，不能改。":
    {
      tw: "群主能看到並修改你的活動，會收到發起、結算完成、收齊三條抄送。你看不到別人負責的活動和收款；「待審核」「成員」只能看，不能改。",
      en: 'The owner can see and change your events, and gets three copies: created, billed and fully paid. You can\'t see other people\'s events or payments; "Pending" and "Members" are view-only.',
    },
  "不想再当管理员时，点下面的「不再当管理员」，弹窗会先列出你的活动会怎么处理。": {
    tw: "不想再當管理員時，點下面的「不再當管理員」，彈窗會先列出你的活動會怎麼處理。",
    en: 'To stop being an admin, tap "Step down as admin" below; it first lists what happens to your events.',
  },
  "不想再当组织者时，点下面的「不再当组织者」，弹窗会先列出你的活动会怎么处理。": {
    tw: "不想再當組織者時，點下面的「不再當組織者」，彈窗會先列出你的活動會怎麼處理。",
    en: 'To stop being an organizer, tap "Step down as organizer" below; it first lists what happens to your events.',
  },
  "Venmo 收款邮件自动对账：编号和名字对上的自动记到这个人的账上：付够了标记已付，不够的显示「部分付款」等补付，多付的列在「需要退款」里；备注里没有本群付款编号的收款直接忽略，不会出现在这里。":
    {
      tw: "Venmo 收款郵件自動對帳：編號和名字對上的自動記到這個人的帳上：付夠了標記已付，不夠的顯示「部分付款」等補付，多付的列在「需要退款」裡；備註裡沒有本群付款編號的收款直接忽略，不會出現在這裡。",
      en: 'Venmo payment emails are matched automatically: when the code and name match, the payment goes to that person\'s bill. Paid in full is marked paid, short shows "Part paid" until topped up, and overpaid is listed under "Refunds due". Payments without this group\'s payment code in the note are ignored and don\'t show here.',
    },
  "已忽略 ({n})": { tw: "已忽略 ({n})", en: "Ignored ({n})" },
  "忽略错了可以移回待确认，再关联到账单；不需要的可以删除。": {
    tw: "忽略錯了可以移回待確認，再關聯到帳單；不需要的可以刪除。",
    en: "If ignored by mistake, move it back to To confirm and match it to a bill; delete the ones you don't need.",
  },
  最近关联的: { tw: "最近關聯的", en: "Recently matched" },
  "已关联到 {x}（{x2}）": { tw: "已關聯到 {x}（{x2}）", en: "Matched to {x} ({x2})" },
  "（未知付款人）": { tw: "（未知付款人）", en: "(unknown payer)" },
  " · 交易 {txnId}": { tw: " · 交易 {txnId}", en: " · transaction {txnId}" },
  " · 进了 {payee} 的账户": { tw: " · 進了 {payee} 的帳戶", en: " · paid into {payee}'s account" },
  待确认: { tw: "待確認", en: "To confirm" },
  没有需要确认的付款: { tw: "沒有需要確認的付款", en: "No payments to confirm" },
  未付清: { tw: "未付清", en: "Not fully paid" },
  "已付清（多付的钱列入需要退款）": {
    tw: "已付清（多付的錢列入需要退款）",
    en: "Paid (the extra goes to refunds due)",
  },
  "这笔已经付清，多出的钱会列入「需要退款」。": {
    tw: "這筆已經付清，多出的錢會列入「需要退款」。",
    en: 'This bill is already paid; the extra will be listed under "Refunds due".',
  },
  "多出的钱会列入「需要退款」。": {
    tw: "多出的錢會列入「需要退款」。",
    en: 'The extra will be listed under "Refunds due".',
  },
  "把这笔{amount}算作 {memberName}（{eventLabel}）的付款？{what}": {
    tw: "把這筆{amount}算作 {memberName}（{eventLabel}）的付款？{what}",
    en: "Count this {amount} as {memberName}'s payment ({eventLabel})?{what}",
  },
  "忽略这笔收款？之后不会再提醒；忽略错了可以在「已忽略」里移回待确认。": {
    tw: "忽略這筆收款？之後不會再提醒；忽略錯了可以在「已忽略」裡移回待確認。",
    en: 'Ignore this payment? You won\'t be reminded again; if it was a mistake, move it back to To confirm from "Ignored".',
  },
  "关联到谁的应付款…": { tw: "關聯到誰的應付款…", en: "Match to whose bill…" },
  "还差 {dollars}": { tw: "還差 {dollars}", en: "{dollars} still due" },
  "已付 {paid}（应付 {due}，已多付）": {
    tw: "已付 {paid}（應付 {due}，已多付）",
    en: "Paid {paid} (owed {due}, overpaid)",
  },
  "已付 {paid}": { tw: "已付 {paid}", en: "Paid {paid}" },
  关联: { tw: "關聯", en: "Match" },
  忽略: { tw: "忽略", en: "Ignore" },
  移回待确认: { tw: "移回待確認", en: "Move back to To confirm" },
  未知付款人: { tw: "未知付款人", en: "Unknown payer" },
  "恢复 {what} 这笔收款？它会回到原来的列表。": {
    tw: "恢復 {what} 這筆收款？它會回到原來的列表。",
    en: "Restore the payment {what}? It goes back to its original list.",
  },
  "永久删除 {what} 这笔收款？删除后无法恢复。": {
    tw: "永久刪除 {what} 這筆收款？刪除後無法恢復。",
    en: "Permanently delete the payment {what}? This can't be undone.",
  },
  "永久删除「已删除」里的全部 {n} 笔收款？删除后无法恢复。": {
    tw: "永久刪除「已刪除」裡的全部 {n} 筆收款？刪除後無法恢復。",
    en: 'Permanently delete all {n} payment(s) in "Deleted"? This can\'t be undone.',
  },
  "已删除 ({n})": { tw: "已刪除 ({n})", en: "Deleted ({n})" },
  "删除的收款保留 {n} 天，之后自动永久删除。": {
    tw: "刪除的收款保留 {n} 天，之後自動永久刪除。",
    en: "Deleted payments are kept for {n} days, then deleted permanently.",
  },
  "{n} 天后永久删除": { tw: "{n} 天后永久刪除", en: "Deleted permanently in {n} days" },
  清空: { tw: "清空", en: "Empty" },
  "永久删除全部 {x} 笔": { tw: "永久刪除全部 {x} 筆", en: "Permanently delete all {x}" },
  "已经把 {dollars} 退给 {memberName} 了？": {
    tw: "已經把 {dollars} 退給 {memberName} 了？",
    en: "Have you refunded {dollars} to {memberName}?",
  },
  "需要退款 ({n})": { tw: "需要退款 ({n})", en: "Refunds due ({n})" },
  需退: { tw: "需退", en: "is owed" },
  "{event} · 应付 {due} · 共收到 {paid}": {
    tw: "{event} · 應付 {due} · 共收到 {paid}",
    en: "{event} · owed {due} · received {paid}",
  },
  已退款: { tw: "已退款", en: "Refunded" },
  退款: { tw: "退款", en: "Refund" },
  手动标记: { tw: "手動標記", en: "Marked by hand" },
  " · 钱在 {elsewhere} 的账户": { tw: " · 錢在 {elsewhere} 的帳戶", en: " · money is in {elsewhere}'s account" },
  "处理中（若一直未完成，处理可能中断）": {
    tw: "處理中（若一直未完成，處理可能中斷）",
    en: "Processing (if it never finishes, processing may have stopped)",
  },
  处理异常: { tw: "處理異常", en: "Processing error" },
  邮件过大: { tw: "郵件過大", en: "Email too large" },
  不是收款通知: { tw: "不是收款通知", en: "Not a payment notice" },
  签名验证失败: { tw: "簽名驗證失敗", en: "Signature check failed" },
  收款字段解析失败: { tw: "收款欄位解析失敗", en: "Couldn't read the payment fields" },
  收款账户不匹配: { tw: "收款帳戶不匹配", en: "Wrong receiving account" },
  重复交易: { tw: "重複交易", en: "Duplicate transaction" },
  已忽略: { tw: "已忽略", en: "Ignored" },
  "多付，需要退款": { tw: "多付，需要退款", en: "Overpaid, refund due" },
  未通过: { tw: "未通過", en: "Failed" },
  需留意: { tw: "需留意", en: "Check" },
  付款记录诊断: { tw: "付款記錄診斷", en: "Payment diagnostics" },
  "默认关闭。开启后记录新收到的 Venmo 邮件处理步骤，包括忽略和失败的邮件。记录最多保留 14 天，关闭后也会自动清理。不会保存完整邮件正文。":
    {
      tw: "預設關閉。開啟後記錄新收到的 Venmo 郵件處理步驟，包括忽略和失敗的郵件。記錄最多保留 14 天，關閉後也會自動清理。不會儲存完整郵件正文。",
      en: "Off by default. When on, it records how each new Venmo email is processed, including ignored and failed ones. Records are kept for at most 14 days and are cleared when turned off. Full email bodies are never saved.",
    },
  开启付款记录诊断: { tw: "開啟付款記錄診斷", en: "Turn on payment diagnostics" },
  "仅群主可查看。诊断记录本身不代表付款已入账，请查看记录里的入账步骤。": {
    tw: "僅群主可查看。診斷記錄本身不代表付款已入帳，請查看記錄裡的入帳步驟。",
    en: "Only the owner can see this. A record doesn't mean the payment was recorded; check the recording step in it.",
  },
  刷新诊断: { tw: "重新整理診斷", en: "Refresh" },
  返回最新记录: { tw: "返回最新記錄", en: "Back to latest" },
  "暂未收到新的 Venmo 邮件": { tw: "暫未收到新的 Venmo 郵件", en: "No new Venmo emails yet" },
  "暂无记录，开启后开始记录新邮件": {
    tw: "暫無記錄，開啟後開始記錄新郵件",
    en: "Nothing recorded; new emails are recorded once it's on",
  },
  查看更早记录: { tw: "查看更早記錄", en: "Show older records" },
  "停在：{x}{x2}": { tw: "停在：{x}{x2}", en: "Stopped at: {x}{x2}" },
  "标题：{subject}": { tw: "標題：{subject}", en: "Subject: {subject}" },
  "（空）": { tw: "（空）", en: "(empty)" },
  "实际：{value}": { tw: "實際：{value}", en: "Actual: {value}" },
  "期望：{value}": { tw: "期望：{value}", en: "Expected: {value}" },
  "只显示已执行的步骤；提前结束后，后续步骤不会执行。签名失败或未完成验证的邮件内容不可信。": {
    tw: "只顯示已執行的步驟；提前結束後，後續步驟不會執行。簽名失敗或未完成驗證的郵件內容不可信。",
    en: "Only steps that ran are shown; after an early stop, later steps don't run. Don't trust the content of emails that failed or didn't finish the signature check.",
  },
  两次输入的新密码不一致: { tw: "兩次輸入的新密碼不一致", en: "The two new passwords don't match" },
  "重新生成后，当前管理链接立即失效。继续吗？": {
    tw: "重新生成後，當前管理連結立即失效。繼續嗎？",
    en: "After regenerating, the current admin link stops working right away. Continue?",
  },
  "‹ 设置": { tw: "‹ 設定", en: "‹ Settings" },
  "‹ 外观和公共页面": { tw: "‹ 外觀和公共頁面", en: "‹ Look & public page" },
  "‹ 高级设置": { tw: "‹ 進階設定", en: "‹ Advanced" },
  外观和公共页面: { tw: "外觀和公共頁面", en: "Look & public page" },
  入群和报名: { tw: "入群和報名", en: "Joining & sign-ups" },
  入群要审核: { tw: "入群要審核", en: "Joining needs approval" },
  高级设置: { tw: "進階設定", en: "Advanced" },
  账号与安全: { tw: "帳號與安全", en: "Account & security" },
  收款账户: { tw: "收款帳戶", en: "Payment accounts" },
  "🔒 修改收款账户（需要群主密码）": {
    tw: "🔒 修改收款帳戶（需要群主密碼）",
    en: "🔒 Change payment accounts (owner password needed)",
  },
  账单提醒: { tw: "帳單提醒", en: "Bill reminders" },
  "每天把数据备份到你自己的 Google 表格": {
    tw: "每天把資料備份到你自己的 Google 表格",
    en: "Back up the data to your own Google Sheet every day",
  },
  修改群主密码: { tw: "修改群主密碼", en: "Change owner password" },
  当前密码: { tw: "當前密碼", en: "Current password" },
  新密码: { tw: "新密碼", en: "New password" },
  再输一次新密码: { tw: "再輸一次新密碼", en: "New password again" },
  保存新密码: { tw: "儲存新密碼", en: "Save new password" },
  "修改后所有设备都会退出登录。忘记密码时，改 GitHub 里的 ADMIN_PASSWORD 并重新部署即可重置。": {
    tw: "修改後所有裝置都會退出登入。忘記密碼時，改 GitHub 裡的 ADMIN_PASSWORD 並重新部署即可重置。",
    en: "All devices are signed out after the change. If you forget the password, change ADMIN_PASSWORD on GitHub and redeploy to reset it.",
  },
  管理链接: { tw: "管理連結", en: "Admin link" },
  新的管理链接: { tw: "新的管理連結", en: "New admin link" },
  "旧链接已失效，请收藏新链接。": {
    tw: "舊連結已失效，請收藏新連結。",
    en: "The old link no longer works; bookmark the new one.",
  },
  打开新链接: { tw: "開啟新連結", en: "Open new link" },
  "怀疑管理链接泄露时，重新生成一个。": {
    tw: "懷疑管理連結洩露時，重新生成一個。",
    en: "If you think the admin link has leaked, regenerate it.",
  },
  重新生成管理链接: { tw: "重新生成管理連結", en: "Regenerate admin link" },
  看看每天的备份是否正常: { tw: "看看每天的備份是否正常", en: "Check that the daily backups are working" },
  我的收款设置: { tw: "我的收款設定", en: "My payment settings" },
  "（未填）": { tw: "（未填）", en: "(not set)" },
  通知邮箱: { tw: "通知電子郵件", en: "Notification email" },
  "还没填好 Venmo 用户名和通知邮箱，你的活动不能结算。": {
    tw: "還沒填好 Venmo 使用者名稱和通知電子郵件，你的活動不能結算。",
    en: "Your Venmo username and notification email aren't filled in, so your events can't be billed.",
  },
  "你负责的活动，成员的钱付到这里。": {
    tw: "你負責的活動，成員的錢付到這裡。",
    en: "Members pay here for events you run.",
  },
  修改收款设置: { tw: "修改收款設定", en: "Change payment settings" },
  "\n\n你还有 {open} 张账单没收齐：60 天内付到旧账户的钱仍然会自动记账。": {
    tw: "\n\n你還有 {open} 張帳單沒收齊：60 天內付到舊帳戶的錢仍然會自動記帳。",
    en: "\n\nYou still have {open} unpaid bill(s): payments to the old account within 60 days are still recorded automatically.",
  },
  "修改后，成员付款页上的收款账号会立即改变。确定修改吗？{note}": {
    tw: "修改後，成員付款頁上的收款帳號會立即改變。確定修改嗎？{note}",
    en: "The account on members' payment pages changes right away. Save the change?{note}",
  },
  "你负责的活动，成员把钱付到这里。填好 Venmo 用户名和通知邮箱之前，你的活动可以报名，但不能结算。": {
    tw: "你負責的活動，成員把錢付到這裡。填好 Venmo 使用者名稱和通知電子郵件之前，你的活動可以報名，但不能結算。",
    en: "Members pay here for events you run. Until your Venmo username and notification email are filled in, your events can take sign-ups but can't be billed.",
  },
  "你的 Venmo 用户名": { tw: "你的 Venmo 使用者名稱", en: "Your Venmo username" },
  "不用加 @": { tw: "不用加 @", en: "Without the @" },
  "Venmo 通知邮箱": { tw: "Venmo 通知電子郵件", en: "Venmo notification email" },
  "Venmo 账户里登记的、接收收款通知的邮箱。只有发到这个邮箱的 Venmo 收款邮件才会自动对账": {
    tw: "Venmo 帳戶裡登記的、接收收款通知的電子郵件。只有發到這個電子郵件的 Venmo 收款郵件才會自動對帳",
    en: "The email on your Venmo account that receives payment notices. Only Venmo payment emails sent to it are matched automatically",
  },
  "你的 Zelle 账号（选填）": { tw: "你的 Zelle 帳號（選填）", en: "Your Zelle account (optional)" },
  "手机号或邮箱，显示在付款页作为备选；Zelle 收款需要你手动标记已付": {
    tw: "手機號或電子郵件，顯示在付款頁作為備選；Zelle 收款需要你手動標記已付",
    en: "Phone number or email, shown on the payment page as an alternative; you mark Zelle payments as paid by hand",
  },
  保存收款设置: { tw: "儲存收款設定", en: "Save payment settings" },
  "Venmo 邮件转发": { tw: "Venmo 郵件轉發", en: "Venmo email forwarding" },
  "系统读取 Venmo 发给你的收款通知邮件，按备注里的付款编号自动记账。你的邮箱密码系统拿不到，只是把 Venmo 的邮件转发过来；和羽毛球无关的收款会被忽略，不会保存。没设好转发的话，成员付款后要你手动标记已付。":
    {
      tw: "系統讀取 Venmo 發給你的收款通知郵件，按備註裡的付款編號自動記帳。你的電子郵件密碼系統拿不到，只是把 Venmo 的郵件轉發過來；和羽毛球無關的收款會被忽略，不會儲存。沒設好轉發的話，成員付款後要你手動標記已付。",
      en: "The site reads the payment notification emails Venmo sends you and records payments by the payment code in the note. It never gets your email password; Venmo's emails are just forwarded. Payments unrelated to badminton are ignored and not saved. Without forwarding, you mark members' payments as paid by hand.",
    },
  "{b}：设好以后，成员用 Venmo 付你负责的活动的账单时，账单会自动变成已付；没变的话，先看「收款 › 待确认」里有没有这笔，再检查上面几步；实在对不上，可以在活动的账单里手动标记已付。":
    {
      tw: "{b}：設好以後，成員用 Venmo 付你負責的活動的帳單時，帳單會自動變成已付；沒變的話，先看「收款 › 待確認」裡有沒有這筆，再檢查上面幾步；實在對不上，可以在活動的帳單裡手動標記已付。",
      en: "{b}: once set up, when members pay your events' bills with Venmo, the bills turn paid automatically. If one doesn't, first look for it under \"Payments › To confirm\", then check the steps above; if it still won't match, mark it paid by hand in the event's bills.",
    },
  "Gmail 会往这个地址发一封确认邮件，里面有确认码。系统收到后会显示在下面（保留 24 小时），连了 Telegram 的话也会发给你。把确认码填回 Gmail，或打开里面的确认链接。":
    {
      tw: "Gmail 會往這個地址發一封確認郵件，裡面有確認碼。系統收到後會顯示在下面（保留 24 小時），連了 Telegram 的話也會發給你。把確認碼填回 Gmail，或開啟裡面的確認連結。",
      en: "Gmail sends a confirmation email with a code to this address. Once it arrives it shows below (kept for 24 hours), and is also sent to your Telegram if connected. Enter the code back in Gmail, or open the confirmation link in it.",
    },
  "{b}（{x} 收到）：": { tw: "{b}（{x} 收到）：", en: "{b} (received {x}):" },
  "Gmail 转发确认邮件": { tw: "Gmail 轉發確認郵件", en: "Gmail forwarding confirmation" },
  "已生效（最近一封在 {fmtInstant} 收到）": {
    tw: "已生效（最近一封在 {fmtInstant} 收到）",
    en: "Working (latest received {fmtInstant})",
  },
  "还没收到你的 Venmo 账户的邮件": { tw: "還沒收到你的 Venmo 帳戶的郵件", en: "No email from your Venmo account yet" },
  "有 {x} 笔账单发出好几天了，却一直没收到你的 Venmo 邮件。如果有人已经用 Venmo 付过款，说明转发可能断了：请按上面的步骤检查 Gmail 的转发地址和过滤器。":
    {
      tw: "有 {x} 筆帳單發出好幾天了，卻一直沒收到你的 Venmo 郵件。如果有人已經用 Venmo 付過款，說明轉發可能斷了：請按上面的步驟檢查 Gmail 的轉寄地址和篩選器。",
      en: "{x} bill(s) went out days ago, but no Venmo email of yours has arrived. If someone has already paid with Venmo, forwarding may be broken: check the forwarding address and filter in Gmail using the steps above.",
    },
  "确定不再当{title}？{revokeSummary}\n\n之后你就进不了管理页了，想再当{title}要请群主重新任命。": {
    tw: "確定不再當{title}？{revokeSummary}\n\n之後你就進不了管理頁了，想再當{title}要請群主重新任命。",
    en: "Step down as {title}?{revokeSummary}\n\nYou'll lose access to the admin page; to become {title} again, ask the owner to reappoint you.",
  },
  "不再当{title}": { tw: "不再當{title}", en: "Step down as {title}" },
  "你负责的活动会交给群主。已经结算的活动，成员的钱仍然付到你的账户，直到收齐。": {
    tw: "你負責的活動會交給群主。已經結算的活動，成員的錢仍然付到你的帳戶，直到收齊。",
    en: "Events you run go to the owner. For events already billed, members still pay into your account until everyone has paid.",
  },
  "TOKEN_KEY 用来加密保存成员链接和管理链接，Cloudflare 里看不到它的值。把它发到你的 Telegram，存进密码管理器后删掉那条消息。":
    {
      tw: "TOKEN_KEY 用來加密儲存成員連結和管理連結，Cloudflare 裡看不到它的值。把它發到你的 Telegram，存進密碼管理器後刪掉那條訊息。",
      en: "TOKEN_KEY encrypts the stored member links and admin link, and its value can't be seen in Cloudflare. Send it to your Telegram, save it in a password manager, then delete the message.",
    },
  "已发送到 Telegram。": { tw: "已傳送到 Telegram。", en: "Sent to Telegram." },
  "发送到 Telegram": { tw: "傳送到 Telegram", en: "Send to Telegram" },
  清空所有数据: { tw: "清空所有資料", en: "Clear all data" },
  "清空后，所有成员、活动、报名、付款记录和设置都会被删除，网站回到初次设置状态。确定要继续吗？": {
    tw: "清空後，所有成員、活動、報名、付款記錄和設定都會被刪除，網站回到初次設定狀態。確定要繼續嗎？",
    en: "Clearing deletes all members, events, sign-ups, payment records and settings, and returns the site to first-time setup. Continue?",
  },
  "最后确认：真的清空所有数据？": { tw: "最後確認：真的清空所有資料？", en: "Final check: really clear all data?" },
  "把网站重置成全新状态。只保留群主密码，清空后用它在 /admin 重新做初次设置。": {
    tw: "把網站重置成全新狀態。只保留群主密碼，清空後用它在 /admin 重新做初次設定。",
    en: "Resets the site to brand new. Only the owner password is kept; use it at /admin to do first-time setup again.",
  },
  "所有成员、活动、报名、付款记录、设置都会被删除，管理链接和所有成员链接都会失效。": {
    tw: "所有成員、活動、報名、付款記錄、設定都會被刪除，管理連結和所有成員連結都會失效。",
    en: "All members, events, sign-ups, payment records and settings will be deleted, and the admin link and all member links will stop working.",
  },
  "请输入「{phrase}」": { tw: "請輸入「{phrase}」", en: 'Type "{phrase}"' },
  确认清空: { tw: "確認清空", en: "Clear everything" },
  公共页面: { tw: "公共頁面", en: "Public pages" },
  网站标题: { tw: "網站標題", en: "Site title" },
  请填写网站标题: { tw: "請填寫網站標題", en: "Please enter a site title" },
  已保存: { tw: "已儲存", en: "Saved" },
  名称: { tw: "名稱", en: "Names" },
  "最多 {n} 个字。已添加的图标要删掉重新添加才会变。": {
    tw: "最多 {n} 個字。已加好的圖示要刪掉重新加入才會變。",
    en: "At most {n} characters. Icons already added keep the old name until removed and added again.",
  },
  桌面图标名称: { tw: "桌面圖示名稱", en: "Home-screen icon name" },
  "桌面图标名称最多 {n} 个字": { tw: "桌面圖示名稱最多 {n} 個字", en: "Each icon name can be at most {n} characters" },
  展示排行榜: { tw: "展示排行榜", en: "Show leaderboard" },
  入群设置: { tw: "入群設定", en: "Joining" },
  入群不需要审核: { tw: "入群不需要審核", en: "Join without approval" },
  "打开后，申请加入的人直接成为成员，不用在「待审核」里通过": {
    tw: "開啟後，申請加入的人直接成為成員，不用在「待審核」裡通過",
    en: 'When on, people who apply become members right away, without approval under "Pending"',
  },
  每天最多自动通过几人: { tw: "每天最多自動通過幾人", en: "Most people let in automatically per day" },
  "1–{n}，超过的申请回到「待审核」": {
    tw: "1–{n}，超過的申請回到「待審核」",
    en: '1–{n}; applications beyond that go back to "Pending"',
  },
  报名设置: { tw: "報名設定", en: "Sign-up settings" },
  每人最多带几个朋友: { tw: "每人最多帶幾個朋友", en: "Friends each member can bring" },
  补建活动和卡路里: { tw: "補建活動和卡路里", en: "Past events and calories" },
  空闲账号提醒: { tw: "空閒帳號提醒", en: "Idle account alert" },
  "空闲账号达到多少 % 时提醒": { tw: "空閒帳號達到多少 % 時提醒", en: "Alert when this % of accounts is idle" },
  "活动进行中，登记的球馆账号里没在打、也没在排队的达到这个比例，就推送给活动的组织者，球场页面上也会提示大家去排队。填 0 关闭。":
    {
      tw: "活動進行中，登記的球館帳號裡沒在打、也沒在排隊的達到這個比例，就推播給活動的組織者，球場頁面上也會提示大家去排隊。填 0 關閉。",
      en: "During an event, when this share of the venue accounts is neither on a court nor queued, the event's organizer gets a push and the Courts section asks everyone to queue. 0 turns it off.",
    },
  可以补建多少天前开始的活动: { tw: "可以補建多少天前開始的活動", en: "How many days back an event can be created" },
  活动开始后多少天内可以读取卡路里: {
    tw: "活動開始後多少天內可以讀取卡路里",
    en: "Days after an event during which calories can be read",
  },
  "快捷指令的名字必须是「{x}」。改了快捷指令以后：把发送的 v 加一，重新分享拿到新的 iCloud 链接，两样一起填在这里。用旧版本读取过的人，活动卡片上会提示更新。":
    {
      tw: "快捷指令的名字必須是「{x}」。改了快捷指令以後：把傳送的 v 加一，重新分享拿到新的 iCloud 連結，兩樣一起填在這裡。用舊版本讀取過的人，活動卡片上會提示更新。",
      en: 'The Shortcut must be named "{x}". After changing the Shortcut, add one to the v it sends, share it again to get a new iCloud link, and enter both here. People who read with an older version see an update prompt on the event card.',
    },
  "iCloud 链接": { tw: "iCloud 連結", en: "iCloud link" },
  "版本号（快捷指令发送的 v）": { tw: "版本號（快捷指令傳送的 v）", en: "Version (the v the Shortcut sends)" },
  "读球馆排队屏幕的照片，要能看图": {
    tw: "讀球館排隊螢幕的照片，要能看圖",
    en: "Reads photos of the venue's queue screen; needs vision",
  },
  "正式版发布后，把改动写成 Telegram 通知": {
    tw: "正式版發布後，把改動寫成 Telegram 通知",
    en: "Writes the changes as a Telegram notice after a production release",
  },
  "低（快）": { tw: "低（快）", en: "Low (fast)" },
  中: { tw: "中", en: "Medium" },
  "高（慢）": { tw: "高（慢）", en: "High (slow)" },
  "AI 模型": { tw: "AI 模型", en: "AI models" },
  "还没有设置 Azure 的 key：拍照登记暂时用不了，发版说明直接列改动标题。": {
    tw: "還沒有設定 Azure 的 key：拍照登記暫時用不了，發版說明直接列改動標題。",
    en: "No Azure key yet: photo check-in doesn't work for now, and release notes just list the change titles.",
  },
  模型: { tw: "模型", en: "Model" },
  "{m}（未部署）": { tw: "{m}（未部署）", en: "{m} (not deployed)" },
  思考强度: { tw: "思考強度", en: "Thinking effort" },
  "出错时自动改用 claude-sonnet-5-5。": {
    tw: "出錯時自動改用 claude-sonnet-5-5。",
    en: "Falls back to claude-sonnet-5-5 on errors.",
  },
  收款设置: { tw: "收款設定", en: "Payment settings" },
  "修改后，成员付款页上的收款账号会立即改变。确定修改吗？": {
    tw: "修改後，成員付款頁上的收款帳號會立即改變。確定修改嗎？",
    en: "The account on members' payment pages changes right away. Save the change?",
  },
  "成员付款时用的账号，一般只需要设置一次。": {
    tw: "成員付款時用的帳號，一般只需要設定一次。",
    en: "The account members pay to; usually set once.",
  },
  "不用加 @，例如 KeLi8916": { tw: "不用加 @，例如 KeLi8916", en: "Without the @, e.g. KeLi8916" },
  "手机号或邮箱，显示在付款页作为备选": {
    tw: "手機號或電子郵件，顯示在付款頁作為備選",
    en: "Phone number or email, shown on the payment page as an alternative",
  },
  "为防止误改，保存收款设置需要输入群主密码": {
    tw: "為防止誤改，儲存收款設定需要輸入群主密碼",
    en: "To prevent accidental changes, saving payment settings needs the owner password",
  },
  默认外观: { tw: "預設外觀", en: "Default look" },
  "（你自己选了别的外观，所以这里换了你看不到变化。）": {
    tw: "（你自己選了別的外觀，所以這裡換了你看不到變化。）",
    en: "(You picked a different look for yourself, so you won't see changes made here.)",
  },
  "解除后不能再用这个 Google 账号进入管理页（管理链接和密码照常可用）。继续吗？": {
    tw: "解除後不能再用這個 Google 帳號進入管理頁（管理連結和密碼照常可用）。繼續嗎？",
    en: "After unlinking, this Google account can no longer open the admin page (the admin link and password still work). Continue?",
  },
  "用 Google 登录管理页": { tw: "用 Google 登入管理頁", en: "Sign in to the admin page with Google" },
  "已绑定 {strong}。用这个账号登录后，在首页或 /admin 就能直接进入管理页，不用链接和密码。": {
    tw: "已綁定 {strong}。用這個帳號登入後，在首頁或 /admin 就能直接進入管理頁，不用連結和密碼。",
    en: "Linked to {strong}. Signed in with this account, you can open the admin page from the home page or /admin without the link and password.",
  },
  "Google 账号": { tw: "Google 帳號", en: "Google account" },
  解除绑定: { tw: "解除綁定", en: "Unlink" },
  "绑定一个 Google 账号（只能一个），以后用它登录就能直接进入管理页。管理链接和密码仍然可用。": {
    tw: "綁定一個 Google 帳號（只能一個），以後用它登入就能直接進入管理頁。管理連結和密碼仍然可用。",
    en: "Link one Google account (only one) to open the admin page just by signing in with it. The admin link and password still work.",
  },
  "当前登录的 {x} 已经属于成员「{x2}」，一个 Google 账号只能对应一个人。请换一个账号。": {
    tw: "當前登入的 {x} 已經屬於成員「{x2}」，一個 Google 帳號只能對應一個人。請換一個帳號。",
    en: '{x}, which you\'re signed in with, already belongs to member "{x2}"; a Google account can only belong to one person. Please use another account.',
  },
  "当前浏览器登录的 Google 账号：{email}": {
    tw: "當前瀏覽器登入的 Google 帳號：{email}",
    en: "Google account signed in on this browser: {email}",
  },
  "绑定 {x}": { tw: "綁定 {x}", en: "Link {x}" },
  "换一个 Google 账号": { tw: "換一個 Google 帳號", en: "Use another Google account" },
  "先登录 Google": { tw: "先登入 Google", en: "Sign in to Google first" },
  "请给这个 Google 账号开启两步验证：绑定后它就是进入管理页的钥匙。": {
    tw: "請給這個 Google 帳號開啟兩步驗證：綁定後它就是進入管理頁的鑰匙。",
    en: "Please turn on 2-Step Verification for this Google account: once linked, it's the key to the admin page.",
  },
  "（{n} 份 {amount}）": { tw: "（{n} 份 {amount}）", en: " ({n} at {amount})" },
  "所有人都标成了未出席，球费不会算进任何人的账单。\n": {
    tw: "所有人都標成了未出席，球費不會算進任何人的帳單。\n",
    en: "Everyone is marked absent, so the shuttlecock cost won't go on anyone's bill.\n",
  },
  "保存后，所有人的金额都会按新数据重新计算；已付款的人会显示还差多少或多付多少。继续吗？": {
    tw: "儲存後，所有人的金額都會按新資料重新計算；已付款的人會顯示還差多少或多付多少。繼續嗎？",
    en: "After saving, everyone's amount is recalculated from the new figures; people who already paid will show how much is still due or overpaid. Continue?",
  },
  "结算后，成员就能看到应付金额和付款链接。确定吗？": {
    tw: "結算後，成員就能看到應付金額和付款連結。確定嗎？",
    en: "After Finalize, members see what they owe and the payment links. Go ahead?",
  },
  结算费用: { tw: "結算費用", en: "Finalize" },
  "费用（已结算，可修改）": { tw: "費用（已结算，可修改）", en: "Costs (finalized, can be changed)" },
  "场地总费用（美元）": { tw: "場地總費用（美元）", en: "Total court fee (USD)" },
  用球个数: { tw: "用球個數", en: "Shuttlecocks used" },
  "球单价（美元）": { tw: "球單價（美元）", en: "Price per shuttlecock (USD)" },
  预览每人金额: { tw: "預覽每人金額", en: "Preview amounts per person" },
  "报名 {x} 人 · 到场 {x2} 人 · 每人场地费 {x3} · 每人球费 {x4}": {
    tw: "報名 {x} 人 · 到場 {x2} 人 · 每人場地費 {x3} · 每人球費 {x4}",
    en: "{x} signed up · {x2} attended · court fee {x3} each · shuttlecocks {x4} each",
  },
  "（含 {n} 个朋友）": { tw: "（含 {n} 個朋友）", en: " (incl. {n} friend(s))" },
  "合计应收 {amount}": { tw: "合計應收 {amount}", en: "Total due {amount}" },
  "所有人都标成了未出席，球费不会算进任何人的账单。": {
    tw: "所有人都標成了未出席，球費不會算進任何人的帳單。",
    en: "Everyone is marked absent, so the shuttlecock cost won't go on anyone's bill.",
  },
  "确认收到 {memberName} 的 {dollars}（现金、Zelle 等），标记已付清？": {
    tw: "確認收到 {memberName} 的 {dollars}（現金、Zelle 等），標記已付清？",
    en: "Received {dollars} from {memberName} (cash, Zelle, etc.)? Mark as paid?",
  },
  "退款 {dollars}": { tw: "退款 {dollars}", en: "Refund {dollars}" },
  "这笔 Venmo 付款会回到待确认，可以再关联到正确的账单。": {
    tw: "這筆 Venmo 付款會回到待確認，可以再關聯到正確的帳單。",
    en: "This Venmo payment goes back to To confirm, where you can match it to the right bill.",
  },
  "撤销 {memberName} 的这笔{what}？{back}": {
    tw: "撤銷 {memberName} 的這筆{what}？{back}",
    en: "Undo {memberName}'s {what}? {back}",
  },
  "停止后不再发送这个活动的每日收款汇总和账单提醒，但未付记录保留、活动不归档。继续吗？": {
    tw: "停止後不再傳送這個活動的每日收款彙總和帳單提醒，但未付記錄保留、活動不歸檔。繼續嗎？",
    en: "Once stopped, this event's daily payment summary and bill reminders stop, but unpaid records stay and the event isn't archived. Continue?",
  },
  "✓ 已收齐，活动已归档": { tw: "✓ 已收齊，活動已歸檔", en: "✓ Fully paid; event archived" },
  收款看板: { tw: "收款看板", en: "Payment board" },
  应收: { tw: "應收", en: "Due" },
  已收: { tw: "已收", en: "Received" },
  未付: { tw: "未付", en: "Unpaid" },
  "{n} 人": { tw: "{n} 人", en: "{n}" },
  没有应付款: { tw: "沒有應付款", en: "Nothing owed" },
  我: { tw: "我", en: "Me" },
  收款人: { tw: "收款人", en: "Payee" },
  "✓ 已付 {dollars}": { tw: "✓ 已付 {dollars}", en: "✓ Paid {dollars}" },
  "部分付款 {dollars} / {dollars2}": { tw: "部分付款 {dollars} / {dollars2}", en: "Part paid {dollars} / {dollars2}" },
  "未付 {dollars}": { tw: "未付 {dollars}", en: "Unpaid {dollars}" },
  "还差 {amount}": { tw: "還差 {amount}", en: "{amount} still due" },
  "多付 {amount}，需要退款": { tw: "多付 {amount}，需要退款", en: "Overpaid {amount}; refund due" },
  补齐已付: { tw: "補齊已付", en: "Mark rest as paid" },
  标记已付: { tw: "標記已付", en: "Mark as paid" },
  "已停止账单提醒 · 点此恢复": { tw: "已停止帳單提醒 · 點此恢復", en: "Bill reminders stopped · tap to resume" },
  停止账单提醒: { tw: "停止帳單提醒", en: "Stop bill reminders" },
  "也可以使用你的专属管理链接进入管理页。": {
    tw: "也可以使用你的專屬管理連結進入管理頁。",
    en: "You can also open the admin page with your own admin link.",
  },
  "管理链接丢失时，可在 GitHub Actions 里手动运行部署并勾选「reset_admin_link」（正式环境选最新的版本标签，测试环境选 main），然后回到这里用群主密码重新设置。":
    {
      tw: "管理連結丟失時，可在 GitHub Actions 裡手動執行部署並勾選「reset_admin_link」（正式環境選最新的版本標籤，測試環境選 main），然後回到這裡用群主密碼重新設定。",
      en: 'If the admin link is lost, run the deploy by hand in GitHub Actions with "reset_admin_link" checked (choose the latest version tag for production, main for the test site), then come back here and set it up again with the owner password.',
    },
  进入管理页: { tw: "進入管理頁", en: "Open admin page" },
  "需要先在管理页「设置」里绑定你的 Google 账号。": {
    tw: "需要先在管理頁「設定」裡綁定你的 Google 帳號。",
    en: "First link your Google account under Settings on the admin page.",
  },
  设置完成: { tw: "設定完成", en: "Setup complete" },
  你的管理链接: { tw: "你的管理連結", en: "Your admin link" },
  "请收藏这个链接，管理页只能从这里进入。": {
    tw: "請收藏這個連結，管理頁只能從這裡進入。",
    en: "Bookmark this link; it's the only way into the admin page.",
  },
  "你自己报名打球也在管理页里：打开某个活动，在「我的报名」里报名、带朋友。": {
    tw: "你自己報名打球也在管理頁裡：開啟某個活動，在「我的報名」裡報名、帶朋友。",
    en: 'You sign up to play from the admin page too: open an event and sign up or bring friends under "My sign-up".',
  },
  首次设置: { tw: "首次設定", en: "First-time setup" },
  "当前的群主密码（第一次部署时就是 GitHub 里的 ADMIN_PASSWORD；在管理页改过的话用改后的）": {
    tw: "當前的群主密碼（第一次部署時就是 GitHub 裡的 ADMIN_PASSWORD；在管理頁改過的話用改後的）",
    en: "The current owner password (ADMIN_PASSWORD on GitHub at first deploy; if changed on the admin page, the new one)",
  },
  你的用户名: { tw: "你的使用者名稱", en: "Your username" },
  你作为成员报名时显示的名字: { tw: "你作為成員報名時顯示的名字", en: "The name shown when you sign up as a member" },
  你的微信昵称: { tw: "你的微信暱稱", en: "Your WeChat nickname" },
  "设置中…": { tw: "設定中…", en: "Setting up…" },
  生成管理链接: { tw: "生成管理連結", en: "Create admin link" },
  "断开后，你负责的活动的提醒会改发给群主。继续吗？": {
    tw: "斷開後，你負責的活動的提醒會改發給群主。繼續嗎？",
    en: "After disconnecting, reminders for your events go to the owner instead. Continue?",
  },
  "断开后不再收到任何通知。继续吗？": {
    tw: "斷開後不再收到任何通知。繼續嗎？",
    en: "After disconnecting you won't get any notifications. Continue?",
  },
  "我的 Telegram": { tw: "我的 Telegram", en: "My Telegram" },
  "Telegram 通知": { tw: "Telegram 通知", en: "Telegram notifications" },
  "还没有配置机器人，请群主在设置里填上机器人的 token。": {
    tw: "還沒有設定機器人，請群主在設定裡填上機器人的 token。",
    en: "No bot yet; the owner needs to enter the bot token in Settings.",
  },
  "还没有配置机器人。请网站维护者在 GitHub secret 里加上 TELEGRAM_BOT_TOKEN 并重新部署。": {
    tw: "還沒有設定機器人。請網站維護者在 GitHub secret 里加上 TELEGRAM_BOT_TOKEN 並重新部署。",
    en: "No bot yet. Ask the site maintainer to add TELEGRAM_BOT_TOKEN as a GitHub secret and redeploy.",
  },
  "✓ 已连接：{strong}{x}": { tw: "✓ 已連線：{strong}{x}", en: "✓ Connected: {strong}{x}" },
  "（机器人 @{bot}）": { tw: "（機器人 @{bot}）", en: " (bot @{bot})" },
  "还没有连接。点下面的按钮会打开 Telegram，在机器人对话里点「Start / 开始」即可。": {
    tw: "還沒有連線。點下面的按鈕會開啟 Telegram，在機器人對話裡點「Start / 開始」即可。",
    en: 'Not connected. The button below opens Telegram; tap "Start" in the bot chat.',
  },
  "连接后，你负责的活动的报名截止、结算和收款提醒{x}会发到这里；没连接时活动的提醒发给群主。": {
    tw: "連線後，你負責的活動的報名截止、結算和收款提醒{x}會發到這裡；沒連線時活動的提醒發給群主。",
    en: "Once connected, sign-up closing, billing and payment reminders for your events{x} come here; when not connected, event reminders go to the owner.",
  },
  "，以及新成员的入群申请": { tw: "，以及新成員的入群申請", en: ", plus new members' applications," },
  "你负责的活动的提醒和账单通知、组织者活动的抄送（发起、结算完成、收齐），以及入群申请等全群的通知发到连接的这个账号。":
    {
      tw: "你負責的活動的提醒和帳單通知、組織者活動的抄送（發起、結算完成、收齊），以及入群申請等全群的通知發到連線的這個帳號。",
      en: "Reminders and bill notices for your events, copies of organizers' events (created, billed, fully paid), and group-wide notices such as applications go to the connected account.",
    },
  "所有提醒和账单通知只发给连接的这一个账号。": {
    tw: "所有提醒和帳單通知只發給連線的這一個帳號。",
    en: "All reminders and bill notices go only to this one connected account.",
  },
  "等待你在 Telegram 里点 Start…（10 分钟内有效）": {
    tw: "等待你在 Telegram 裡點 Start…（10 分鐘內有效）",
    en: "Waiting for you to tap Start in Telegram… (valid for 10 minutes)",
  },
  "已发送，请在 Telegram 里查看。": { tw: "已傳送，請在 Telegram 裡查看。", en: "Sent; check Telegram." },
  "换一个 Telegram 账号": { tw: "換一個 Telegram 帳號", en: "Use another Telegram account" },
  发送测试消息: { tw: "傳送測試訊息", en: "Send test message" },
  断开连接: { tw: "斷開連線", en: "Disconnect" },
  更换机器人: { tw: "更換機器人", en: "Change bot" },
  "换成新机器人后，群主和组织者都要重新连接 Telegram。继续吗？": {
    tw: "換成新機器人後，群主和組織者都要重新連線 Telegram。繼續嗎？",
    en: "After changing the bot, the owner and organizers all need to reconnect Telegram. Continue?",
  },
  "在 Telegram 里找 @BotFather，发送 /newbot 建一个机器人，把它给的 token 粘贴到这里。之后群主和组织者各自连接这个机器人接收通知。":
    {
      tw: "在 Telegram 裡找 @BotFather，傳送 /newbot 建一個機器人，把它給的 token 貼上到這裡。之後群主和組織者各自連線這個機器人接收通知。",
      en: "In Telegram, find @BotFather, send /newbot to create a bot, and paste the token it gives you here. The owner and organizers then each connect to this bot for notifications.",
    },
  "机器人 token": { tw: "機器人 token", en: "Bot token" },
  保存机器人: { tw: "儲存機器人", en: "Save bot" },
  提醒设置: { tw: "提醒設定", en: "Reminders" },
  报名截止前提醒: { tw: "報名截止前提醒", en: "Reminder before sign-up closes" },
  截止前几小时提醒: { tw: "截止前幾小時提醒", en: "Hours before closing" },
  "账单提醒时间（太平洋时间）": { tw: "帳單提醒時間（太平洋時間）", en: "Bill reminder time (Pacific)" },
  "结算 24 小时后每天这时发，直到收齐。": {
    tw: "結算 24 小時後每天這時發，直到收齊。",
    en: "Sent at this time every day from 24 hours after Finalize until everyone has paid.",
  },
  每周一发送健康简报: { tw: "每週一傳送健康簡報", en: "Send a health report every Monday" },
  在收款设置的账单提醒时间发送: {
    tw: "在收款設定的帳單提醒時間傳送",
    en: "Sent at the bill reminder time set in Payment settings",
  },
  拍照登记: { tw: "拍照登記", en: "Photo check-in" },
  发版说明: { tw: "發版說明", en: "Release notes" },
  "密码至少 {n} 位": { tw: "密碼至少 {n} 位", en: "Passwords need at least {n} characters" },
  "每天最多自动通过的人数请填 1–{n}": {
    tw: "每天最多自動通過的人數請填 1–{n}",
    en: "The daily limit for automatic joins must be 1–{n}",
  },
  无需收款: { tw: "無需收款", en: "No fees to collect" },
  "大家到球场各付各的，活动结束后不用结算和收款": {
    tw: "大家到球場各付各的，活動結束後不用結算和收款",
    en: "Everyone pays the venue at the door; nothing to settle or collect afterwards",
  },
  "大家在球场各付各的，这次活动不用结算。活动结束 1 小时后（{time}）会自动结束，存进历史活动。": {
    tw: "大家在球場各付各的，這次活動不用結算。活動結束 1 小時後（{time}）會自動結束，存進歷史活動。",
    en: "Everyone pays the venue themselves, so there is nothing to settle. The event ends by itself 1 hour after it finishes ({time}) and moves to past events.",
  },
  现在结束活动: { tw: "現在結束活動", en: "End event now" },
  "结束后活动存进历史活动，名单不能再改。确定结束吗？": {
    tw: "結束後活動存進歷史活動，名單不能再改。確定結束嗎？",
    en: "Once ended, the event moves to past events and its list can't be changed. End it now?",
  },
};
