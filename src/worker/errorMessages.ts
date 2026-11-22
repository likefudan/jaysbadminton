// 繁體 and English for the errors the Worker answers with that the pages don't already translate
// (src/web/messages.ts, adminMessages.ts): errorText.ts looks in all three. Keyed, like those, by the
// Simplified Chinese in the code, with {name} for what changes. test/errorText.test.ts fails when an
// error has no entry here or there.
// English terms as on the pages: 活动 event, 球馆 venue, 球场 court, 群主 Owner, 结算 finalize.

export const ERROR_MESSAGES: Record<string, { tw: string; en: string }> = {
  // Anyone
  找不到这个地址: { tw: "找不到這個網址", en: "Page not found" },
  "服务器出错了，请稍后再试": {
    tw: "伺服器出錯了，請稍後再試",
    en: "Something went wrong on the server. Please try again later.",
  },
  "登录失败，请重试": { tw: "登入失敗，請重試", en: "Sign-in failed. Please try again." },
  "专属链接已停止找回，请用 Google 登录": {
    tw: "專屬連結已停止找回，請用 Google 登入",
    en: "Personal links can no longer be recovered. Please sign in with Google.",
  },
  "这个网站还不支持 App 登录": {
    tw: "這個網站還不支援 App 登入",
    en: "This site doesn't support signing in from the app yet",
  },
  "这个网站还不支持 App 推送": {
    tw: "這個網站還不支援 App 推播",
    en: "This site doesn't support app notifications yet",
  },
  "App 的推送信息不对，请重试": {
    tw: "App 的推播資訊不對，請重試",
    en: "The app's notification details are invalid. Please try again.",
  },
  总入口的请求无效: { tw: "總入口的請求無效", en: "Invalid request from the app hub" },
  "你的账号已停用。有疑问请联系 {name}。": {
    tw: "你的帳號已停用。有疑問請聯繫 {name}。",
    en: "Your account has been deactivated. Please contact {name} with any questions.",
  },
  "这个读取链接已经用过或者过期了，请回到活动页再点一次「读取」": {
    tw: "這個讀取連結已經用過或者過期了，請回到活動頁再點一次「讀取」",
    en: "This read link has been used or has expired. Go back to the event page and tap Read again.",
  },
  卡路里数字不对: { tw: "卡路里數字不對", en: "Invalid calorie number" },
  这场活动不在你的花费记录里: { tw: "這場活動不在你的花費記錄裡", en: "This event isn't in your spending records" },
  "金额要在 $0 到 ${max} 之间": { tw: "金額要在 $0 到 ${max} 之間", en: "The amount must be between $0 and ${max}" },

  // Signing up, friends
  不能带自己: { tw: "不能帶自己", en: "You can't bring yourself" },
  只能带正常状态的群友: { tw: "只能帶正常狀態的群友", en: "You can only bring active members" },
  群友名单格式不对: { tw: "群友名單格式不對", en: "Invalid member list" },
  "{name} 已经在名单上了": { tw: "{name} 已經在名單上了", en: "{name} is already on the list" },
  "{name} 已经被 {by} 带了": { tw: "{name} 已經被 {by} 帶了", en: "{name} is already being brought by {by}" },
  "{name} 自己带了群友，不能再被带": {
    tw: "{name} 自己帶了群友，不能再被帶",
    en: "{name} is bringing other members, so they can't be brought",
  },
  "{name} 是别人带来的，不能再带朋友": {
    tw: "{name} 是別人帶來的，不能再帶朋友",
    en: "{name} was brought by someone else and can't bring friends",
  },
  "{names} 刚刚已经报名了，没能带上；其他的已经保存": {
    tw: "{names} 剛剛已經報名了，沒能帶上；其他的已經儲存",
    en: "{names} just signed up themselves, so they weren't added; everything else was saved",
  },
  "{name} 已经带你报名了。要自己报名，请先点「我不去了」": {
    tw: "{name} 已經帶你報名了。要自己報名，請先點「我不去了」",
    en: "{name} has already signed you up. To sign up yourself, first tap “I can't make it”",
  },
  "{name} 已经带你报名了。要自己报名，请先在名单里把你删掉": {
    tw: "{name} 已經帶你報名了。要自己報名，請先在名單裡把你刪掉",
    en: "{name} has already signed you up. To sign up yourself, first remove yourself from the list",
  },
  到的时间不在活动时间内: { tw: "到的時間不在活動時間內", en: "The arrival time is outside the event's hours" },
  请先选到的时间: { tw: "請先選到的時間", en: "Please pick an arrival time first" },
  "走的时间要在到的时间之后、活动结束之前": {
    tw: "走的時間要在到的時間之後、活動結束之前",
    en: "The leaving time must be after the arrival time and before the event ends",
  },

  // 球场排队
  请选择在打还是排第几组: { tw: "請選擇在打還是排第幾組", en: "Please choose playing or a place in the queue" },
  "时间请填 {min}–{max} 分钟": { tw: "時間請填 {min}–{max} 分鐘", en: "Please enter {min}–{max} minutes" },
  "每轮时间请填 {min}–{max} 分钟": {
    tw: "每輪時間請填 {min}–{max} 分鐘",
    en: "Please enter {min}–{max} minutes per round",
  },
  找不到这条记录: { tw: "找不到這筆記錄", en: "Entry not found" },
  "密码最多 {n} 个字": { tw: "密碼最多 {n} 個字", en: "Passwords can be at most {n} characters" },
  "要删除哪一场？": { tw: "要刪除哪一場？", en: "Which court should be deleted?" },

  // Creating and changing events
  请选择日期: { tw: "請選擇日期", en: "Please pick a date" },
  请填写开始和结束时间: { tw: "請填寫開始和結束時間", en: "Please enter the start and end times" },
  请填写场馆: { tw: "請填寫場館", en: "Please enter the venue" },
  "场馆名最多 60 个字": { tw: "場館名最多 60 個字", en: "Venue names can be at most 60 characters" },
  "地址最多 200 个字": { tw: "地址最多 200 個字", en: "Addresses can be at most 200 characters" },
  "活动标题最多 {n} 个字": { tw: "活動標題最多 {n} 個字", en: "Event titles can be at most {n} characters" },
  "备注最多 1000 个字": { tw: "備註最多 1000 個字", en: "Notes can be at most 1000 characters" },
  "备注最多 {n} 个字": { tw: "備註最多 {n} 個字", en: "Notes can be at most {n} characters" },
  场地编号不对: { tw: "場地編號不對", en: "Invalid court number" },
  同一天的活动太多了: { tw: "同一天的活動太多了", en: "Too many events on the same day" },
  "同时创建的活动太多，请稍后再试": {
    tw: "同時建立的活動太多，請稍後再試",
    en: "Too many events are being created at once. Please try again later.",
  },
  "截止时间请选择提前 0–14 天、0–23 小时": {
    tw: "截止時間請選擇提前 0–14 天、0–23 小時",
    en: "Please set the deadline 0–14 days and 0–23 hours before the start",
  },
  这个活动已经开始了: { tw: "這個活動已經開始了", en: "This event has already started" },
  这个活动已经结束了: { tw: "這個活動已經結束了", en: "This event has already ended" },
  "已经开始的活动最多补建 {n} 天内的": {
    tw: "已經開始的活動最多補建 {n} 天內的",
    en: "Events that have already started can only be added up to {n} days back",
  },
  "按这个提前量算出的截止时间已经过了，请调整": {
    tw: "按這個提前量算出的截止時間已經過了，請調整",
    en: "The deadline this works out to has already passed. Please adjust it.",
  },
  "这个活动刚刚有了变化，请刷新后再改": {
    tw: "這個活動剛剛有了變化，請重新整理後再改",
    en: "This event just changed. Please refresh and try again.",
  },
  "活动已经结算，不能再改场地": {
    tw: "活動已經結算，不能再改場地",
    en: "This event has been finalized, so the courts can't be changed",
  },
  已经结算的活动不能改成无需收款: {
    tw: "已經結算的活動不能改成無需收款",
    en: "A finalized event can't be switched to no fees",
  },
  "已经结算，不能再改自己的报名；需要调整请直接改名单": {
    tw: "已經結算，不能再改自己的報名；需要調整請直接改名單",
    en: "This event has been finalized, so you can't change your sign-up. Edit the list instead.",
  },
  找不到你本人的成员记录: { tw: "找不到你本人的成員記錄", en: "Your own member record wasn't found" },
  只能在结算之前取消活动: { tw: "只能在結算之前取消活動", en: "Events can only be cancelled before they're finalized" },
  只能删除已收齐归档或已取消的活动: {
    tw: "只能刪除已收齊歸檔或已取消的活動",
    en: "Only fully paid and archived, or cancelled, events can be deleted",
  },
  只有报名中的活动可以提前截止: {
    tw: "只有報名中的活動可以提前截止",
    en: "Only events open for sign-up can be closed early",
  },
  "只能重新开放已截止、还没结算的活动": {
    tw: "只能重新開放已截止、還沒結算的活動",
    en: "Only closed events that haven't been finalized can be reopened",
  },
  请填写新的截止时间: { tw: "請填寫新的截止時間", en: "Please enter the new deadline" },
  新的截止时间必须晚于现在: { tw: "新的截止時間必須晚於現在", en: "The new deadline must be in the future" },
  截止时间最晚只能到活动结束: {
    tw: "截止時間最晚只能到活動結束",
    en: "The deadline can be no later than the end of the event",
  },
  只能添加正常状态的成员: { tw: "只能新增正常狀態的成員", en: "Only active members can be added" },
  请选择要添加的人: { tw: "請選擇要新增的人", en: "Please choose who to add" },
  只能修改朋友的名字: { tw: "只能修改朋友的名字", en: "Only friends' names can be changed" },
  "这个活动需要结算收款，请在下面填写费用后点「结算费用」": {
    tw: "這個活動需要結算收款，請在下面填寫費用後點「結算費用」",
    en: "This event collects fees. Enter the costs below and tap Finalize.",
  },
  "报名还没截止，请先截止报名再结束活动": {
    tw: "報名還沒截止，請先截止報名再結束活動",
    en: "Sign-up is still open. Close sign-up before ending the event.",
  },
  已收齐归档或已取消的活动不能转交: {
    tw: "已收齊歸檔或已取消的活動不能轉交",
    en: "Fully paid and archived, or cancelled, events can't be handed over",
  },
  "只能转给群主、管理员或现任组织者": {
    tw: "只能轉給群主、管理員或現任組織者",
    en: "Events can only be handed to the Owner, an admin or a current organizer",
  },

  // Finalizing and payments
  "请填写场地总费用（美元）": { tw: "請填寫場地總費用（美元）", en: "Please enter the total court cost (USD)" },
  请填写用球个数: { tw: "請填寫用球個數", en: "Please enter the number of shuttles used" },
  "请填写羽毛球单价（美元）": { tw: "請填寫羽毛球單價（美元）", en: "Please enter the price per shuttle (USD)" },
  "场地总费用超过 ${max}，请检查是否多打了一个 0": {
    tw: "場地總費用超過 ${max}，請檢查是否多打了一個 0",
    en: "The court cost is over ${max}. Please check for an extra 0.",
  },
  "羽毛球单价超过 ${max}，请检查是否填错": {
    tw: "羽毛球單價超過 ${max}，請檢查是否填錯",
    en: "The shuttle price is over ${max}. Please check it.",
  },
  "这个活动无需收款，不用结算": {
    tw: "這個活動無需收款，不用結算",
    en: "This event has no fees, so it doesn't need finalizing",
  },
  "报名还没截止，不能结算": {
    tw: "報名還沒截止，不能結算",
    en: "Sign-up is still open, so the event can't be finalized",
  },
  "名单是空的，不能结算": { tw: "名單是空的，不能結算", en: "The list is empty, so the event can't be finalized" },
  "已经结算的活动不能把名单删空，否则费用没人分摊。如果活动其实没办成，请先在下面把费用都改成 0 并保存": {
    tw: "已經結算的活動不能把名單刪空，否則費用沒人分攤。如果活動其實沒辦成，請先在下面把費用都改成 0 並儲存",
    en: "A finalized event can't have an empty list, or no one would share the cost. If the event didn't happen, first set the costs below to 0 and save.",
  },
  "这样就没有人到场了，球费没人分摊。如果确实没人用球，请先在下面把用球个数改成 0 并保存": {
    tw: "這樣就沒有人到場了，球費沒人分攤。如果確實沒人用球，請先在下面把用球個數改成 0 並儲存",
    en: "Then no one attended and no one would share the shuttle cost. If no shuttles were used, first set the number of shuttles below to 0 and save.",
  },
  "这场活动的状态刚刚变了，请刷新页面后再试": {
    tw: "這場活動的狀態剛剛變了，請重新整理頁面後再試",
    en: "This event's status just changed. Please refresh the page and try again.",
  },
  "这场活动的负责人或收款人刚刚换了，请刷新页面后再试": {
    tw: "這場活動的負責人或收款人剛剛換了，請重新整理頁面後再試",
    en: "This event's organizer or payee just changed. Please refresh the page and try again.",
  },
  找不到这笔应付款: { tw: "找不到這筆應付款", en: "Amount due not found" },
  这笔已经付清了: { tw: "這筆已經付清了", en: "This has already been paid in full" },
  找不到这笔付款记录: { tw: "找不到這筆付款記錄", en: "Payment record not found" },
  找不到这笔收款: { tw: "找不到這筆收款", en: "Payment not found" },
  这笔收款已经处理过了: { tw: "這筆收款已經處理過了", en: "This payment has already been handled" },
  这笔没有需要退的钱: { tw: "這筆沒有需要退的錢", en: "There's nothing to refund on this one" },
  这笔应付款不能关联: { tw: "這筆應付款不能關聯", en: "This amount due can't be matched" },
  这个活动还没结算: { tw: "這個活動還沒結算", en: "This event hasn't been finalized yet" },
  "这个活动已收齐归档，只能撤销多付的 Venmo 付款": {
    tw: "這個活動已收齊歸檔，只能撤銷多付的 Venmo 付款",
    en: "This event is fully paid and archived; only Venmo overpayments can be undone",
  },
  "这个活动归档已超过 {n} 天，不能再撤销": {
    tw: "這個活動歸檔已超過 {n} 天，不能再撤銷",
    en: "This event was archived more than {n} days ago and can no longer be undone",
  },
  "这个活动归档已超过 {n} 天，不能再关联": {
    tw: "這個活動歸檔已超過 {n} 天，不能再關聯",
    en: "This event was archived more than {n} days ago and can no longer be matched",
  },
  "{name}本人的账单自动记为已付，不用撤销": {
    tw: "{name}本人的帳單自動記為已付，不用撤銷",
    en: "{name}'s own bill is marked paid automatically and doesn't need undoing",
  },
  "{name}本人的账单不用关联": { tw: "{name}本人的帳單不用關聯", en: "{name}'s own bill doesn't need matching" },
  "这个成员已删除，他付清的账单不能再关联": {
    tw: "這個成員已刪除，他付清的帳單不能再關聯",
    en: "This member has been deleted, so their paid bills can no longer be matched",
  },
  "这笔收款没有金额，请改用「标记已付」": {
    tw: "這筆收款沒有金額，請改用「標記已付」",
    en: "This payment has no amount. Use Mark as paid instead.",
  },
  "这笔付款已经记在一张账单上了，不能再移回待确认；需要改的话请在那张账单里撤销": {
    tw: "這筆付款已經記在一張帳單上了，不能再移回待確認；需要改的話請在那張帳單裡撤銷",
    en: "This payment is already on a bill and can't go back to To confirm. To change it, undo it on that bill.",
  },
  只能把已忽略的收款移回待确认: {
    tw: "只能把已忽略的收款移回待確認",
    en: "Only ignored payments can be moved back to To confirm",
  },
  "只能删除待确认或已忽略的收款；已关联的请在账单里撤销": {
    tw: "只能刪除待確認或已忽略的收款；已關聯的請在帳單裡撤銷",
    en: "Only payments that are to confirm or ignored can be deleted; undo matched ones on their bill",
  },
  "这笔收款不在「已删除」里": { tw: "這筆收款不在「已刪除」裡", en: "This payment isn't in Deleted" },
  "只有已结算、还没收齐的活动才能停止账单提醒": {
    tw: "只有已結算、還沒收齊的活動才能停止帳單提醒",
    en: "Bill reminders can only be stopped for finalized events that aren't fully paid",
  },

  // Payment settings (Venmo)
  "Venmo 用户名格式不对（不用加 @）": {
    tw: "Venmo 使用者名稱格式不對（不用加 @）",
    en: "Invalid Venmo username (leave out the @)",
  },
  "请填写 Venmo 通知邮箱（Venmo 账户里登记的邮箱）": {
    tw: "請填寫 Venmo 通知信箱（Venmo 帳戶裡登記的信箱）",
    en: "Please enter the Venmo notification email (the email on your Venmo account)",
  },
  "Venmo 通知邮箱格式不对": { tw: "Venmo 通知信箱格式不對", en: "Invalid Venmo notification email" },
  "这个 Venmo 用户名已经是群主或其他组织者的收款账户（或 {n} 天内用过），请换一个": {
    tw: "這個 Venmo 使用者名稱已經是群主或其他組織者的收款帳戶（或 {n} 天內用過），請換一個",
    en: "This Venmo username already belongs to the Owner or another organizer (or was used in the last {n} days). Please use another.",
  },
  "这个 Venmo 通知邮箱已经是群主或其他组织者的收款账户（或 {n} 天内用过），请换一个": {
    tw: "這個 Venmo 通知信箱已經是群主或其他組織者的收款帳戶（或 {n} 天內用過），請換一個",
    en: "This Venmo notification email already belongs to the Owner or another organizer (or was used in the last {n} days). Please use another.",
  },
  "这个 Venmo 账户已经是其他人的收款账户，请换一个": {
    tw: "這個 Venmo 帳戶已經是其他人的收款帳戶，請換一個",
    en: "This Venmo account already belongs to someone else. Please use another.",
  },
  "还有 {n} 张账单没收齐，不能清空 Venmo 用户名；可以换成新的账户": {
    tw: "還有 {n} 張帳單沒收齊，不能清空 Venmo 使用者名稱；可以換成新的帳戶",
    en: "{n} bills are still unpaid, so the Venmo username can't be cleared; you can switch to a new account",
  },
  "请先在收款设置里填好 Venmo 和通知邮箱": {
    tw: "請先在收款設定裡填好 Venmo 和通知信箱",
    en: "Please fill in Venmo and the notification email in Payment settings first",
  },
  "本场收款人 {name} 还没在收款设置里填好 Venmo 和通知邮箱": {
    tw: "本場收款人 {name} 還沒在收款設定裡填好 Venmo 和通知信箱",
    en: "This event's payee, {name}, hasn't filled in Venmo and the notification email in Payment settings yet",
  },
  "这场已经结算发出账单，收款人不能再换": {
    tw: "這場已經結算發出帳單，收款人不能再換",
    en: "This event has been finalized and billed, so the payee can't change",
  },
  "群主的收款设置请在「设置 › 收款设置」里修改（需要群主密码）": {
    tw: "群主的收款設定請在「設定 › 收款設定」裡修改（需要群主密碼）",
    en: "Change the Owner's payment settings in Settings › Payment settings (needs the Owner password)",
  },

  // Members, roles
  找不到这个成员: { tw: "找不到這個成員", en: "Member not found" },
  找不到群主的成员记录: { tw: "找不到群主的成員記錄", en: "The Owner's member record wasn't found" },
  这个成员不是正常状态: { tw: "這個成員不是正常狀態", en: "This member isn't active" },
  不能停用群主本人: { tw: "不能停用群主本人", en: "The Owner can't be deactivated" },
  只能恢复已停用的成员: { tw: "只能恢復已停用的成員", en: "Only deactivated members can be restored" },
  只能删除已停用的成员: { tw: "只能刪除已停用的成員", en: "Only deactivated members can be deleted" },
  只能拒绝待审核的申请: { tw: "只能拒絕待審核的申請", en: "Only pending applications can be declined" },
  这个申请已经处理过了: { tw: "這個申請已經處理過了", en: "This application has already been handled" },
  "只能向已通过审核、留了邮箱的成员发送通知": {
    tw: "只能向已通過審核、留了信箱的成員發送通知",
    en: "Notices can only be sent to approved members who left an email",
  },
  只能给正常或已停用的成员生成链接: {
    tw: "只能給正常或已停用的成員產生連結",
    en: "Links can only be made for active or deactivated members",
  },
  "这位成员已绑定 Google 账号，不再使用专属链接": {
    tw: "這位成員已綁定 Google 帳號，不再使用專屬連結",
    en: "This member has linked a Google account and no longer uses a personal link",
  },
  这个成员目前没有有效链接: { tw: "這個成員目前沒有有效連結", en: "This member has no valid link right now" },
  "这个链接已无法显示（网站密钥换过），请点「重新生成」给他一个新链接": {
    tw: "這個連結已無法顯示（網站金鑰換過），請點「重新產生」給他一個新連結",
    en: "This link can no longer be shown (the site key changed). Tap Regenerate to give them a new one.",
  },
  "刚才有别的操作改了他的状态，请刷新页面后再试": {
    tw: "剛才有別的操作改了他的狀態，請重新整理頁面後再試",
    en: "Something else just changed this member's status. Please refresh the page and try again.",
  },
  "刚才有别的操作改了他的身份或状态，请刷新页面后再试": {
    tw: "剛才有別的操作改了他的身分或狀態，請重新整理頁面後再試",
    en: "Something else just changed this member's role or status. Please refresh the page and try again.",
  },
  "{name} 还有 ${amount} 没付清，付清或标记已付后才能删除": {
    tw: "{name} 還有 ${amount} 沒付清，付清或標記已付後才能刪除",
    en: "{name} still owes ${amount}. They can be deleted once it's paid or marked as paid.",
  },
  "{name} 还在 {date} 活动的名单上，这场还没收齐，费用还可能变。请等这场收齐归档，或者把这个人从名单上删掉，再删除成员":
    {
      tw: "{name} 還在 {date} 活動的名單上，這場還沒收齊，費用還可能變。請等這場收齊歸檔，或者把這個人從名單上刪掉，再刪除成員",
      en: "{name} is still on the list for the {date} event, which isn't fully paid and whose fees may still change. Wait until it's archived, or remove them from the list, then delete the member.",
    },
  "{name} 还在 {date} 活动的名单上，这场还没结算。请先结算这场，或者把这个人从名单上删掉，再删除成员": {
    tw: "{name} 還在 {date} 活動的名單上，這場還沒結算。請先結算這場，或者把這個人從名單上刪掉，再刪除成員",
    en: "{name} is still on the list for the {date} event, which hasn't been finalized. Finalize it, or remove them from the list, then delete the member.",
  },
  "{name} 还有管理员身份。请先「恢复」（会撤销管理员身份），再停用、删除": {
    tw: "{name} 還有管理員身分。請先「恢復」（會撤銷管理員身分），再停用、刪除",
    en: "{name} is still an admin. Restore them first (which removes the admin role), then deactivate and delete.",
  },
  "{name} 还有组织者身份。请先「恢复」（会撤销组织者身份），再停用、删除": {
    tw: "{name} 還有組織者身分。請先「恢復」（會撤銷組織者身分），再停用、刪除",
    en: "{name} is still an organizer. Restore them first (which removes the organizer role), then deactivate and delete.",
  },
  "{name} 是 {date} 活动的收款人，这场还没收齐归档。请等这场收齐归档后再删除成员": {
    tw: "{name} 是 {date} 活動的收款人，這場還沒收齊歸檔。請等這場收齊歸檔後再刪除成員",
    en: "{name} is the payee of the {date} event, which isn't fully paid and archived yet. Delete the member once it is.",
  },
  "{name} 是 {date} 活动的负责人，这场还没收齐归档。请等这场收齐归档（或把它转交给别人）后再删除成员": {
    tw: "{name} 是 {date} 活動的負責人，這場還沒收齊歸檔。請等這場收齊歸檔（或把它轉交給別人）後再刪除成員",
    en: "{name} runs the {date} event, which isn't fully paid and archived yet. Delete the member once it is (or hand the event to someone else).",
  },
  群主本来就有全部权限: { tw: "群主本來就有全部權限", en: "The Owner already has every permission" },
  只能任命状态正常的成员: { tw: "只能任命狀態正常的成員", en: "Only active members can be appointed" },
  "{name} 已经是管理员了": { tw: "{name} 已經是管理員了", en: "{name} is already an admin" },
  "{name} 已经是组织者了": { tw: "{name} 已經是組織者了", en: "{name} is already an organizer" },
  "{name} 不是管理员": { tw: "{name} 不是管理員", en: "{name} isn't an admin" },
  "{name} 不是组织者": { tw: "{name} 不是組織者", en: "{name} isn't an organizer" },
  "{name} 不是组织者或管理员": { tw: "{name} 不是組織者或管理員", en: "{name} isn't an organizer or admin" },
  "{name} 还没有关联 Google 账号。请他先用 Google 登录关联，再任命": {
    tw: "{name} 還沒有關聯 Google 帳號。請他先用 Google 登入關聯，再任命",
    en: "{name} hasn't linked a Google account yet. Ask them to sign in with Google first, then appoint them.",
  },
  "请先「恢复」这个成员（会撤销管理员身份）": {
    tw: "請先「恢復」這個成員（會撤銷管理員身分）",
    en: "Restore this member first (which removes the admin role)",
  },
  "请先「恢复」这个成员（会撤销组织者身份）": {
    tw: "請先「恢復」這個成員（會撤銷組織者身分）",
    en: "Restore this member first (which removes the organizer role)",
  },
  只有组织者或管理员可以这样做: { tw: "只有組織者或管理員可以這樣做", en: "Only organizers and admins can do this" },
  只有群主可以对群主或管理员做这个操作: {
    tw: "只有群主可以對群主或管理員做這個操作",
    en: "Only the Owner can do this to the Owner or an admin",
  },
  组织者功能还没有开放: { tw: "組織者功能還沒有開放", en: "Organizers aren't available yet" },
  这一行不在这场活动的名单上: { tw: "這一行不在這場活動的名單上", en: "This row isn't on this event's list" },
  成员编号计数器缺失: { tw: "成員編號計數器缺失", en: "The member number counter is missing" },

  // Signing in to the admin pages
  "请用群主、管理员或组织者的 Google 账号登录": {
    tw: "請用群主、管理員或組織者的 Google 帳號登入",
    en: "Please sign in with the Google account of the Owner, an admin or an organizer",
  },
  请输入群主密码: { tw: "請輸入群主密碼", en: "Please enter the Owner password" },
  群主密码不正确: { tw: "群主密碼不正確", en: "The Owner password is incorrect" },
  密码不正确: { tw: "密碼不正確", en: "Incorrect password" },
  当前密码不正确: { tw: "目前密碼不正確", en: "The current password is incorrect" },
  "密码错误次数过多，请 {n} 分钟后再试": {
    tw: "密碼錯誤次數過多，請 {n} 分鐘後再試",
    en: "Too many wrong passwords. Please try again in {n} minutes.",
  },
  系统尚未配置群主密码: { tw: "系統尚未設定群主密碼", en: "The Owner password hasn't been set up" },
  管理链接已经设置过了: { tw: "管理連結已經設定過了", en: "The admin link has already been set up" },
  请先使用开发者登录: { tw: "請先使用開發者登入", en: "Please use the developer sign-in first" },
  "请先在这个浏览器登录 Google": {
    tw: "請先在這個瀏覽器登入 Google",
    en: "Please sign in to Google in this browser first",
  },
  "群主已经绑定了一个 Google 账号，请先解除绑定": {
    tw: "群主已經綁定了一個 Google 帳號，請先解除綁定",
    en: "The Owner already has a Google account linked. Unlink it first.",
  },
  "这个 Google 账号已经属于成员「{name}」，一个 Google 账号只能对应一个人": {
    tw: "這個 Google 帳號已經屬於成員「{name}」，一個 Google 帳號只能對應一個人",
    en: "This Google account already belongs to the member “{name}”; each Google account can belong to one person only",
  },
  "这个 Google 账号的邮箱已经登记在另一位成员（或待审核的申请）名下，请先处理那条记录或换一个账号": {
    tw: "這個 Google 帳號的信箱已經登記在另一位成員（或待審核的申請）名下，請先處理那筆記錄或換一個帳號",
    en: "This Google account's email is already registered to another member (or a pending application). Deal with that record first or use another account.",
  },
  "请输入「{phrase}」确认": { tw: "請輸入「{phrase}」確認", en: "Type “{phrase}” to confirm" },

  // 设置
  "带朋友上限请填 0–10": { tw: "帶朋友上限請填 0–10", en: "Please enter a friend limit of 0–10" },
  "补建天数请填 1–{max}": { tw: "補建天數請填 1–{max}", en: "Please enter 1–{max} days for adding past events" },
  "读取卡路里天数请填 1–{max}": {
    tw: "讀取卡路里天數請填 1–{max}",
    en: "Please enter 1–{max} days for reading calories",
  },
  "空闲账号比例请填 0–100（0 是关闭）": {
    tw: "空閒帳號比例請填 0–100（0 是關閉）",
    en: "Please enter an idle account percentage of 0–100 (0 turns it off)",
  },
  球馆账号显示方式不对: { tw: "球館帳號顯示方式不對", en: "Invalid way to show venue accounts" },
  "请填 iCloud 快捷指令链接（https://www.icloud.com/shortcuts/…）": {
    tw: "請填 iCloud 捷徑連結（https://www.icloud.com/shortcuts/…）",
    en: "Please enter an iCloud Shortcut link (https://www.icloud.com/shortcuts/…)",
  },
  "版本号请填 1–999": { tw: "版本號請填 1–999", en: "Please enter a version number of 1–999" },
  请选择模型: { tw: "請選擇模型", en: "Please choose a model" },
  请选择思考强度: { tw: "請選擇思考強度", en: "Please choose a thinking effort" },
  "网站标题最多 {n} 个字": { tw: "網站標題最多 {n} 個字", en: "Site titles can be at most {n} characters" },
  问候语的显示方式不对: { tw: "問候語的顯示方式不對", en: "Invalid greeting style" },
  桌面图标名称格式不对: { tw: "桌面圖示名稱格式不對", en: "Invalid home-screen icon name" },
  排行榜格式不对: { tw: "排行榜格式不對", en: "Invalid leaderboard settings" },
  没有这个配色: { tw: "沒有這個配色", en: "No such color scheme" },
  没有这个透明度: { tw: "沒有這個透明度", en: "No such transparency level" },
  "截止前提醒请填 1–72 小时": {
    tw: "截止前提醒請填 1–72 小時",
    en: "Please enter 1–72 hours for the deadline reminder",
  },
  "账单提醒时间请选 0–23 点": { tw: "帳單提醒時間請選 0–23 點", en: "Please pick an hour of 0–23 for bill reminders" },
  "结算期限请填 1–{max} 小时": {
    tw: "結算期限請填 1–{max} 小時",
    en: "Please enter a finalize deadline of 1–{max} hours",
  },
  "没有查到 Azure 上的模型，请稍后再试": {
    tw: "沒有查到 Azure 上的模型，請稍後再試",
    en: "No models were found on Azure. Please try again later.",
  },
  没有这个表: { tw: "沒有這個表", en: "No such table" },
  诊断分页编号无效: { tw: "診斷分頁編號無效", en: "Invalid diagnostics page number" },
  请选择开启或关闭诊断: { tw: "請選擇開啟或關閉診斷", en: "Please choose to turn diagnostics on or off" },

  // Telegram
  "还没有配置 Telegram 机器人：请群主在设置里填上机器人的 token": {
    tw: "還沒有設定 Telegram 機器人：請群主在設定裡填上機器人的 token",
    en: "No Telegram bot is set up yet: the Owner needs to enter the bot's token in Settings",
  },
  "连接 Telegram 失败：{reason}": { tw: "連接 Telegram 失敗：{reason}", en: "Couldn't connect to Telegram: {reason}" },
  "设置 Telegram 回调失败：{reason}": {
    tw: "設定 Telegram 回呼失敗：{reason}",
    en: "Couldn't set up the Telegram webhook: {reason}",
  },
  "这个网站的机器人由 GitHub secret 设置，不能在这里改": {
    tw: "這個網站的機器人由 GitHub secret 設定，不能在這裡改",
    en: "This site's bot is set by a GitHub secret and can't be changed here",
  },
  "token 格式不对：应该是 BotFather 给的「数字:字母」那一串": {
    tw: "token 格式不對：應該是 BotFather 給的「數字:字母」那一串",
    en: "Invalid token: it should be the “numbers:letters” string from BotFather",
  },
  "Telegram 不认这个 token：{reason}": {
    tw: "Telegram 不認這個 token：{reason}",
    en: "Telegram doesn't accept this token: {reason}",
  },
  "发送失败：请先连接 Telegram，或检查机器人是否被停用": {
    tw: "發送失敗：請先連接 Telegram，或檢查機器人是否被停用",
    en: "Couldn't send: connect Telegram first, or check whether the bot was blocked",
  },
};
