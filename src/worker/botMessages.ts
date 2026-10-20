// Translations for the Telegram bot (botLang.ts), keyed by the Simplified Chinese in the code.
// zh-TW was converted from Simplified (OpenCC, Taiwan phrasing) and then read over by hand. The
// admin pages stay Simplified Chinese, so English text names their labels (收款, 设置 › …) as shown.

export const BOT_MESSAGES: Record<string, { tw: string; en: string }> = {
  "—— 可复制到微信 ——": { tw: "—— 可複製到微信 ——", en: "—— Copy to WeChat ——" },
  "管理页（用 Google 登录）：{link}": {
    tw: "管理頁（用 Google 登入）：{link}",
    en: "Admin page (sign in with Google): {link}",
  },
  "抄送：{title} {name} 的收款账户": {
    tw: "抄送：{title} {name} 的收款帳戶",
    en: "CC: {title} {name}'s payment account",
  },
  "抄送：{title} {name} 负责的活动": { tw: "抄送：{title} {name} 負責的活動", en: "CC: event run by {title} {name}" },
  获取管理页面链接: { tw: "取得管理頁面連結", en: "Get the admin page link" },
  "切换语言 / Language": { tw: "切換語言 / Language", en: "Change language" },
  "✅ 已连接。羽毛球群的提醒、结算和账单提醒都会发到这里。\n忘记管理页面地址时，在这里发送「管理页面」即可找回。": {
    tw: "✅ 已連線。羽毛球群的提醒、結算和帳單提醒都會發到這裡。\n忘記管理頁面地址時，在這裡傳送「管理頁面」即可找回。",
    en: '✅ Connected. Group reminders, settlements and bill reminders will come here.\nIf you forget the admin page address, send "admin" here to get it back.',
  },
  "✅ 已连接。你负责的活动的提醒、结算和账单提醒（管理员还有入群申请）都会发到这里。\n管理页（用 Google 登录）：{link}":
    {
      tw: "✅ 已連線。你負責的活動的提醒、結算和帳單提醒（管理員還有入群申請）都會發到這裡。\n管理頁（用 Google 登入）：{link}",
      en: "✅ Connected. Reminders, settlements and bill reminders for the events you run (and, for admins, join requests) will come here.\nAdmin page (sign in with Google): {link}",
    },
  "发送「语言」可以切换语言（简体 / 繁體 / English）。": {
    tw: "傳送「語言」可以切換語言（簡體 / 繁體 / English）。",
    en: 'Send "language" to change the language (简体 / 繁體 / English).',
  },
  "请选择 Telegram 通知的语言（只影响这个聊天，不影响网页）：": {
    tw: "請選擇 Telegram 通知的語言（只影響這個聊天，不影響網頁）：",
    en: "Choose the language for Telegram notifications (only this chat, not the website):",
  },
  "✅ 以后的通知都会用{name}。": {
    tw: "✅ 以後的通知都會用{name}。",
    en: "✅ Notifications will be in {name} from now on.",
  },
  "管理页（用 Google 登录）：": { tw: "管理頁（用 Google 登入）：", en: "Admin page (sign in with Google):" },
  "管理页面：": { tw: "管理頁面：", en: "Admin page:" },
  "打开后还需要输入群主密码。请不要转发这个链接。": {
    tw: "開啟後還需要輸入群主密碼。請不要轉發這個連結。",
    en: "You will also need the owner password after opening it. Please don't forward this link.",
  },
  "（之前的管理链接无法找回，已为你生成新的，旧链接已失效。）": {
    tw: "（之前的管理連結無法找回，已為你生成新的，舊連結已失效。）",
    en: "(The previous admin link can't be recovered, so a new one was made and the old one no longer works.)",
  },
  "⏰ {day} 的活动报名还剩约 {left} 小时截止，目前 {n} 人。": {
    tw: "⏰ {day} 的活動報名還剩約 {left} 小時截止，目前 {n} 人。",
    en: "⏰ Sign-up for {day} closes in about {left} h, {n} signed up so far.",
  },
  "🔒 {day} 的活动报名已截止，共 {n} 人。": {
    tw: "🔒 {day} 的活動報名已截止，共 {n} 人。",
    en: "🔒 Sign-up for {day} is closed, {n} signed up.",
  },
  "💰 {day} 的活动已经结束，没有人报名，不用结算。\n可以在管理页取消这个活动。": {
    tw: "💰 {day} 的活動已經結束，沒有人報名，不用結算。\n可以在管理頁取消這個活動。",
    en: "💰 {day} is over and nobody signed up, so there is nothing to settle.\nYou can cancel this event on the admin page.",
  },
  "💰 {day} 的活动已经结束，还没有结算（报名 {n} 人）。\n请打开管理页：标记没来的人，填写场地费和用球数，然后点 Finalize。":
    {
      tw: "💰 {day} 的活動已經結束，還沒有結算（報名 {n} 人）。\n請開啟管理頁：標記沒來的人，填寫場地費和用球數，然後點 Finalize。",
      en: "💰 {day} is over but not settled yet ({n} signed up).\nOpen the admin page: mark who didn't come, enter the court fee and shuttles used, then click Finalize.",
    },
  "{name} 还差 {amount}": { tw: "{name} 還差 {amount}", en: "{name} still owes {amount}" },
  "📋 {day} 收款汇总：应收 {due}，已收 {paid}；已付清 {done} 人，未付清 {owing} 人：\n{lines}\n\n下面是每个人的账单提醒，可以分别复制到微信私聊。":
    {
      tw: "📋 {day} 收款彙總：應收 {due}，已收 {paid}；已付清 {done} 人，未付清 {owing} 人：\n{lines}\n\n下面是每個人的帳單提醒，可以分別複製到微信私聊。",
      en: "📋 Payments for {day}: {due} due, {paid} received; {done} paid in full, {owing} not yet:\n{lines}\n\nBelow is a bill reminder for each person, to copy into a private WeChat chat.",
    },
  "账单提醒：{name}（微信：{wechat}）": {
    tw: "帳單提醒：{name}（微信：{wechat}）",
    en: "Bill reminder: {name} (WeChat: {wechat})",
  },
  "✅ {day} 已结算，应收合计 {total}：\n{lines}": {
    tw: "✅ {day} 已結算，應收合計 {total}：\n{lines}",
    en: "✅ {day} is settled, {total} due in total:\n{lines}",
  },
  "🎉 费用已全部收齐，活动已归档": {
    tw: "🎉 費用已全部收齊，活動已歸檔",
    en: "🎉 All fees collected, the event is archived",
  },
  "活动：{title}": { tw: "活動：{title}", en: "Event: {title}" },
  "日期：{date} {start}–{end}": { tw: "日期：{date} {start}–{end}", en: "Date: {date} {start}–{end}" },
  "活动编号：{number}": { tw: "活動編號：{number}", en: "Event number: {number}" },
  "场馆：{location}": { tw: "場館：{location}", en: "Venue: {location}" },
  "地址：{address}": { tw: "地址：{address}", en: "Address: {address}" },
  "人数：报名 {registered} 人，到场 {attended} 人（{paying} 人付款）": {
    tw: "人數：報名 {registered} 人，到場 {attended} 人（{paying} 人付款）",
    en: "People: {registered} signed up, {attended} came ({paying} paying)",
  },
  "费用：{amount}": { tw: "費用：{amount}", en: "Cost: {amount}" },
  "场地费 {amount}": { tw: "場地費 {amount}", en: "Court fee {amount}" },
  "球费 {amount}（{count} 个 × {price}）": {
    tw: "球費 {amount}（{count} 個 × {price}）",
    en: "Shuttles {amount} ({count} × {price})",
  },
  "应收 {due}，实收 {paid}": { tw: "應收 {due}，實收 {paid}", en: "{due} due, {paid} received" },
  "还有多付的 {amount} 需要退，见管理页「收款」。": {
    tw: "還有多付的 {amount} 需要退，見管理頁「收款」。",
    en: "{amount} was overpaid and needs refunding, see 收款 on the admin page.",
  },
  "❓ 有一笔 Venmo 付款需要确认：{payer} {amount}，备注「{note}」。\n原因：{reason}\n请到管理页「收款」把它关联到某人名下，或者忽略。":
    {
      tw: "❓ 有一筆 Venmo 付款需要確認：{payer} {amount}，備註「{note}」。\n原因：{reason}\n請到管理頁「收款」把它關聯到某人名下，或者忽略。",
      en: '❓ A Venmo payment needs confirming: {payer} {amount}, note "{note}".\nReason: {reason}\nOn the admin page under 收款, link it to someone or ignore it.',
    },
  "💵 {name} 付了 {amount}（{date}），还差 {owed}。": {
    tw: "💵 {name} 付了 {amount}（{date}），還差 {owed}。",
    en: "💵 {name} paid {amount} ({date}), still {owed} to go.",
  },
  "↩️ {name} 多付了 {over}（{date}，应付 {due}，共收到 {received}），需要退款，见管理页「收款」。": {
    tw: "↩️ {name} 多付了 {over}（{date}，應付 {due}，共收到 {received}），需要退款，見管理頁「收款」。",
    en: "↩️ {name} overpaid by {over} ({date}: {due} due, {received} received in total) and needs a refund, see 收款 on the admin page.",
  },
  "🆕 {title} {name} 发起了新活动：\n{when}\n地点：{venue}\n{link}": {
    tw: "🆕 {title} {name} 發起了新活動：\n{when}\n地點：{venue}\n{link}",
    en: "🆕 {title} {name} created a new event:\n{when}\nVenue: {venue}\n{link}",
  },
  "📭 {quiet}，但还有 {owing} 笔账单没付清。\n如果最近确实有人用 Venmo 付过款，说明 Gmail 转发可能断了：请检查 Gmail 的转发地址和过滤器（管理页「设置 → 使用指南」第二部分）。":
    {
      tw: "📭 {quiet}，但還有 {owing} 筆帳單沒付清。\n如果最近確實有人用 Venmo 付過款，說明 Gmail 轉發可能斷了：請檢查 Gmail 的轉發地址和過濾器（管理頁「設定 → 使用指南」第二部分）。",
      en: "📭 {quiet}, yet {owing} bills are still unpaid.\nIf someone did pay by Venmo lately, Gmail forwarding may have stopped: check the forwarding address and filter in Gmail (admin page 设置 → 使用指南, part 2).",
    },
  "📭 {quiet}，但付到这个账户的账单还有 {owing} 笔没付清。\n如果最近确实有人用 Venmo 付过款，说明这个账户的 Gmail 转发可能断了：请检查 Gmail 的转发地址和过滤器（组织者或管理员的管理页「设置 › Venmo 邮件转发」）。":
    {
      tw: "📭 {quiet}，但付到這個帳戶的帳單還有 {owing} 筆沒付清。\n如果最近確實有人用 Venmo 付過款，說明這個帳戶的 Gmail 轉發可能斷了：請檢查 Gmail 的轉發地址和過濾器（組織者或管理員的管理頁「設定 › Venmo 郵件轉發」）。",
      en: "📭 {quiet}, yet {owing} bills paying into this account are still unpaid.\nIf someone did pay by Venmo lately, this account's Gmail forwarding may have stopped: check the forwarding address and filter in Gmail (the organizer's or admin's admin page 设置 › Venmo 邮件转发).",
    },
  "已经 {days} 天没收到 {account}的 Venmo 邮件了": {
    tw: "已經 {days} 天沒收到 {account}的 Venmo 郵件了",
    en: "No Venmo email for {account} for {days} days",
  },
  "系统还没收到过 {account}的 Venmo 邮件": {
    tw: "系統還沒收到過 {account}的 Venmo 郵件",
    en: "No Venmo email for {account} has arrived yet",
  },
  "已经 {days} 天没收到任何 Venmo 邮件了": {
    tw: "已經 {days} 天沒收到任何 Venmo 郵件了",
    en: "No Venmo email at all for {days} days",
  },
  "系统还没收到过任何 Venmo 邮件": { tw: "系統還沒收到過任何 Venmo 郵件", en: "No Venmo email has arrived yet" },
  "每周简报（{date} 起的 7 天）": { tw: "每週簡報（{date} 起的 7 天）", en: "Weekly digest (7 days from {date})" },
  "活动：举办了 {n} 场": { tw: "活動：舉辦了 {n} 場", en: "Events: {n} held" },
  要你处理: { tw: "要你處理", en: "for you to handle" },
  "请检查 Gmail 转发": { tw: "請檢查 Gmail 轉發", en: "please check Gmail forwarding" },
  "【群主（你）的账户】": { tw: "【群主（你）的帳戶】", en: "[Your account (group owner)]" },
  "【{title} {name} 的账户】": { tw: "【{title} {name} 的帳戶】", en: "[{title} {name}'s account]" },
  "由 {name} 处理": { tw: "由 {name} 處理", en: "for {name} to handle" },
  "请提醒 {name} 检查 Gmail 转发": {
    tw: "請提醒 {name} 檢查 Gmail 轉發",
    en: "please remind {name} to check Gmail forwarding",
  },
  "请检查这个账户的 Gmail 转发": {
    tw: "請檢查這個帳戶的 Gmail 轉發",
    en: "please check this account's Gmail forwarding",
  },
  "⚠️ 定时任务出过错（{at}）：{error}": {
    tw: "⚠️ 定時任務出過錯（{at}）：{error}",
    en: "⚠️ A scheduled job failed ({at}): {error}",
  },
  "✓ 定时任务：正常": { tw: "✓ 定時任務：正常", en: "✓ Scheduled jobs: OK" },
  "· Google 表格同步：没有开启": { tw: "· Google 表格同步：沒有開啟", en: "· Google Sheets sync: off" },
  "⚠️ Google 表格同步：最近一次在 {at}，已超过 2 天": {
    tw: "⚠️ Google 表格同步：最近一次在 {at}，已超過 2 天",
    en: "⚠️ Google Sheets sync: last on {at}, more than 2 days ago",
  },
  "⚠️ Google 表格同步：还没同步过": { tw: "⚠️ Google 表格同步：還沒同步過", en: "⚠️ Google Sheets sync: never synced" },
  "✓ Google 表格同步：最近一次在 {at}": {
    tw: "✓ Google 表格同步：最近一次在 {at}",
    en: "✓ Google Sheets sync: last on {at}",
  },
  "Venmo 邮件：这周一封也没收到": { tw: "Venmo 郵件：這週一封也沒收到", en: "Venmo email: none this week" },
  "Venmo 邮件：收到 {n} 封（{kinds}）": {
    tw: "Venmo 郵件：收到 {n} 封（{kinds}）",
    en: "Venmo email: {n} received ({kinds})",
  },
  "待确认：还有 {n} 笔{by}": { tw: "待確認：還有 {n} 筆{by}", en: "To confirm: {n} left, {by}" },
  "待确认：没有": { tw: "待確認：沒有", en: "To confirm: none" },
  "未付清账单：{n} 笔，共 {amount}": {
    tw: "未付清帳單：{n} 筆，共 {amount}",
    en: "Unpaid bills: {n}, {amount} in total",
  },
  "未付清账单：没有": { tw: "未付清帳單：沒有", en: "Unpaid bills: none" },
  "待退款：{n} 笔，共 {amount}": { tw: "待退款：{n} 筆，共 {amount}", en: "Refunds owed: {n}, {amount} in total" },
  "⚠️ 收款设置还没填 Venmo 用户名": {
    tw: "⚠️ 收款設定還沒填 Venmo 使用者名稱",
    en: "⚠️ No Venmo username in the payment settings yet",
  },
  "⚠️ 邮件转发：还没收到过任何 Venmo 邮件，自动对账可能还没设置好": {
    tw: "⚠️ 郵件轉發：還沒收到過任何 Venmo 郵件，自動對帳可能還沒設定好",
    en: "⚠️ Email forwarding: no Venmo email has arrived yet, so automatic matching may not be set up",
  },
  "⚠️ 邮件转发：最近一封在 {at}，有欠款却很久没收到，{fix}": {
    tw: "⚠️ 郵件轉發：最近一封在 {at}，有欠款卻很久沒收到，{fix}",
    en: "⚠️ Email forwarding: last one on {at}; money is owed but nothing has come for a long time, {fix}",
  },
  "✓ 邮件转发：最近一封在 {at}": { tw: "✓ 郵件轉發：最近一封在 {at}", en: "✓ Email forwarding: last one on {at}" },
  "📮 Gmail 转发确认邮件\n{content}\n\n把上面的确认码填到 Gmail 设置里，或打开里面的确认链接。": {
    tw: "📮 Gmail 轉發確認郵件\n{content}\n\n把上面的確認碼填到 Gmail 設定裡，或開啟裡面的確認連結。",
    en: "📮 Gmail forwarding confirmation\n{content}\n\nEnter the confirmation code above in Gmail's settings, or open the confirmation link in it.",
  },
  新成员申请待审核: { tw: "新成員申請待審核", en: "New member application to review" },
  "用户名：{name}": { tw: "使用者名稱：{name}", en: "Username: {name}" },
  "微信名：{name}": { tw: "微信名：{name}", en: "WeChat name: {name}" },
  "Google 邮箱：{email}": { tw: "Google 信箱：{email}", en: "Google email: {email}" },
  "邮箱：{email}": { tw: "信箱：{email}", en: "Email: {email}" },
  "留言：{message}": { tw: "留言：{message}", en: "Message: {message}" },
  "请在管理页「待审核」处理。": {
    tw: "請在管理頁「待審核」處理。",
    en: "Please handle it under 待审核 on the admin page.",
  },
  "{site}的 TOKEN_KEY（{origin}）：": {
    tw: "{site}的 TOKEN_KEY（{origin}）：",
    en: "TOKEN_KEY of the {site} ({origin}):",
  },
  "请存进密码管理器，并存为 GitHub secret {secret}，然后删除这条消息。每次部署都会核对它；万一 Worker 的 secret 丢了，部署时会自动用它填回去。":
    {
      tw: "請存進密碼管理器，並存為 GitHub secret {secret}，然後刪除這條訊息。每次部署都會核對它；萬一 Worker 的 secret 丟了，部署時會自動用它填回去。",
      en: "Save it in a password manager and as the GitHub secret {secret}, then delete this message. Every deploy checks it; if the Worker secret is ever lost, the deploy puts it back from there.",
    },
  "🔁 {by} 把活动 {label} 转交给了 {to}。\n成员的钱以后付给 {to}，不再付给你。": {
    tw: "🔁 {by} 把活動 {label} 轉交給了 {to}。\n成員的錢以後付給 {to}，不再付給你。",
    en: "🔁 {by} handed event {label} over to {to}.\nMembers will pay {to} from now on, not you.",
  },
  "🗑 活动 {label} 已从数据库永久删除（报名、账单和付款记录一并删除）。\n\n如果不是你本人操作，请立刻修改群主密码。": {
    tw: "🗑 活動 {label} 已從資料庫永久刪除（報名、帳單和付款記錄一併刪除）。\n\n如果不是你本人操作，請立刻修改群主密碼。",
    en: "🗑 Event {label} was permanently deleted from the database (with its sign-ups, bills and payments).\n\nIf this wasn't you, change the owner password right away.",
  },
  "（空）": { tw: "（空）", en: "(empty)" },
  "🔐 收款设置已修改\n{lines}\n\n如果不是你本人操作，请立刻修改群主密码。": {
    tw: "🔐 收款設定已修改\n{lines}\n\n如果不是你本人操作，請立刻修改群主密碼。",
    en: "🔐 Payment settings changed\n{lines}\n\nIf this wasn't you, change the owner password right away.",
  },
  "🔐 {title} {name} 的收款设置已修改\n{lines}": {
    tw: "🔐 {title} {name} 的收款設定已修改\n{lines}",
    en: "🔐 {title} {name}'s payment settings changed\n{lines}",
  },
  "🔐 你的收款设置已修改\n{lines}\n\n如果不是你本人操作，请马上告诉群主。": {
    tw: "🔐 你的收款設定已修改\n{lines}\n\n如果不是你本人操作，請馬上告訴群主。",
    en: "🔐 Your payment settings changed\n{lines}\n\nIf this wasn't you, tell the group owner right away.",
  },
  "🏸 测试消息：通知工作正常。": { tw: "🏸 測試訊息：通知工作正常。", en: "🏸 Test message: notifications work." },
  "这场由 {name} 负责，但组织者功能已关闭，这条发给群主。": {
    tw: "這場由 {name} 負責，但組織者功能已關閉，這條發給群主。",
    en: "{name} runs this event but the organizers feature is off, so this went to the group owner.",
  },
  "这场的负责人 {name} 已经不是组织者或管理员，这条发给群主。": {
    tw: "這場的負責人 {name} 已經不是組織者或管理員，這條發給群主。",
    en: "{name}, who runs this event, is no longer an organizer or admin, so this went to the group owner.",
  },
  "这条是关于 {name} 的收款账户的，但组织者功能已关闭，这条发给群主。": {
    tw: "這條是關於 {name} 的收款帳戶的，但組織者功能已關閉，這條發給群主。",
    en: "This is about {name}'s payment account but the organizers feature is off, so this went to the group owner.",
  },
  "这条是关于历史收款人 {name} 的收款账户的（已经不是组织者或管理员），这条发给群主。": {
    tw: "這條是關於歷史收款人 {name} 的收款帳戶的（已經不是組織者或管理員），這條發給群主。",
    en: "This is about former payee {name}'s payment account (no longer an organizer or admin), so this went to the group owner.",
  },
  "{title} {name} 还没连接 Telegram，这条发给群主。": {
    tw: "{title} {name} 還沒連線 Telegram，這條發給群主。",
    en: "{title} {name} hasn't connected Telegram, so this went to the group owner.",
  },
  "发给{title} {name} 的 Telegram 没有成功，这条发给群主。": {
    tw: "發給{title} {name} 的 Telegram 沒有成功，這條發給群主。",
    en: "Telegram to {title} {name} failed, so this went to the group owner.",
  },
  "⚠️ 收到一封 Venmo 收款邮件，但系统读不懂它的格式（可能是 Venmo 改版了），这笔付款没有自动记账。\n请在 Venmo App 里核对最近的收款，必要时在管理页手动标记已付，并告诉网站维护者。":
    {
      tw: "⚠️ 收到一封 Venmo 收款郵件，但系統讀不懂它的格式（可能是 Venmo 改版了），這筆付款沒有自動記帳。\n請在 Venmo App 裡核對最近的收款，必要時在管理頁手動標記已付，並告訴網站維護者。",
      en: "⚠️ A Venmo payment email arrived but its format couldn't be read (Venmo may have changed it), so the payment was not recorded automatically.\nCheck recent payments in the Venmo app, mark them paid on the admin page if needed, and tell the site maintainer.",
    },
  "⚠️ 收到一封自称来自 Venmo、但签名校验失败的邮件，已拒绝（可能是伪造的）。\n如果最近确实有人付款，请在 Venmo App 里核对，并在管理页手动标记已付。":
    {
      tw: "⚠️ 收到一封自稱來自 Venmo、但簽名校驗失敗的郵件，已拒絕（可能是偽造的）。\n如果最近確實有人付款，請在 Venmo App 裡核對，並在管理頁手動標記已付。",
      en: "⚠️ An email claiming to be from Venmo failed the signature check and was rejected (it may be forged).\nIf someone did pay lately, check in the Venmo app and mark it paid on the admin page.",
    },
  "⚠️ 收到一封 Venmo 收款邮件，但收款账号或收件邮箱和「收款设置」里的不一致，已忽略。\n请检查设置里的 Venmo 用户名和 Venmo 通知邮箱是否填对。":
    {
      tw: "⚠️ 收到一封 Venmo 收款郵件，但收款帳號或收件信箱和「收款設定」裡的不一致，已忽略。\n請檢查設定裡的 Venmo 使用者名稱和 Venmo 通知信箱是否填對。",
      en: "⚠️ A Venmo payment email was ignored: its account or recipient address doesn't match the payment settings.\nCheck that the Venmo username and Venmo notification email in the settings are right.",
    },
  "⚠️ 收到一封转发到 {name} 的 Venmo 收款邮件，但收款账号和 {name} 的收款设置里的 Venmo 用户名不一致，已忽略。\n请检查管理页「设置 › 我的收款设置」里的 Venmo 用户名和通知邮箱是否填对。":
    {
      tw: "⚠️ 收到一封轉發到 {name} 的 Venmo 收款郵件，但收款帳號和 {name} 的收款設定裡的 Venmo 使用者名稱不一致，已忽略。\n請檢查管理頁「設定 › 我的收款設定」裡的 Venmo 使用者名稱和通知信箱是否填對。",
      en: "⚠️ A Venmo payment email forwarded to {name} was ignored: its account doesn't match the Venmo username in {name}'s payment settings.\nCheck the Venmo username and notification email under 设置 › 我的收款设置 on the admin page.",
    },
  自动记账: { tw: "自動記帳", en: "matched" },
  部分付款: { tw: "部分付款", en: "partial" },
  多付: { tw: "多付", en: "overpaid" },
  待确认: { tw: "待確認", en: "to confirm" },
  "无关收款（已忽略）": { tw: "無關收款（已忽略）", en: "unrelated (ignored)" },
  异常: { tw: "異常", en: "problems" },
  群主: { tw: "群主", en: "group owner" },
  管理员: { tw: "管理員", en: "admin" },
  组织者: { tw: "組織者", en: "organizer" },
  历史收款人: { tw: "歷史收款人", en: "former payee" },
  测试站: { tw: "測試站", en: "test site" },
  正式网站: { tw: "正式網站", en: "live site" },
  "Venmo 通知邮箱": { tw: "Venmo 通知信箱", en: "Venmo notification email" },
  这次活动已从数据库永久删除: {
    tw: "這次活動已從資料庫永久刪除",
    en: "This event was permanently deleted from the database",
  },
  "付到了 {account}的账户，这个账户已经不再收本群的款": {
    tw: "付到了 {account}的帳戶，這個帳戶已經不再收本群的款",
    en: "Paid into {account}'s account, which no longer takes this group's payments",
  },
  "付到了 {account}的账户，但这场的收款人是 {payee}": {
    tw: "付到了 {account}的帳戶，但這場的收款人是 {payee}",
    en: "Paid into {account}'s account, but this event's payee is {payee}",
  },
  这次活动还没结算: { tw: "這次活動還沒結算", en: "This event isn't settled yet" },
  这次活动已取消: { tw: "這次活動已取消", en: "This event was cancelled" },
  编号里的成员没有这次活动的应付款: {
    tw: "編號裡的成員沒有這次活動的應付款",
    en: "The member in the code has no bill for this event",
  },
  "备注里的名字和编号 {code} 不是同一个人": {
    tw: "備註裡的名字和編號 {code} 不是同一個人",
    en: "The name in the note and the code {code} are not the same person",
  },
  "暂时无法校验 Venmo 签名，请核对后手动关联": {
    tw: "暫時無法校驗 Venmo 簽名，請核對後手動關聯",
    en: "The Venmo signature can't be checked right now; please check and link it by hand",
  },
  "🚀 新版本 {tag} 已发布到正式网站": {
    tw: "🚀 新版本 {tag} 已發布到正式網站",
    en: "🚀 Version {tag} is now live",
  },
  "……还有 {n} 项改动": { tw: "……還有 {n} 項改動", en: "…and {n} more changes" },
  "这次的更新：": { tw: "這次的更新：", en: "What's new:" },
  "这次没有大家能看到的变化，只是内部改进。": {
    tw: "這次沒有大家看得到的變化，只是內部改進。",
    en: "Nothing you'll notice this time, only behind-the-scenes improvements.",
  },
};
