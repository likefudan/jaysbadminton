import type { Lang } from "../lang";

/**
 * The privacy policy and terms, written out in each language rather than looked up sentence by
 * sentence in messages.ts: legal text reads better kept whole. A string is a paragraph, an array
 * is a bulleted list. Change all three languages together, and the date with them. {site} and {host}
 * stand for this site's name and address, so every site deployed from this code names itself.
 */
export interface LegalDoc {
  updated: string;
  sections: { h: string; body: (string | string[])[] }[];
}

const CONTACT = "likefudan@gmail.com";

export const PRIVACY: Record<Lang, LegalDoc> = {
  "zh-CN": {
    updated: "最后更新：2026 年 11 月 18 日",
    sections: [
      {
        h: "这个网站是谁的",
        body: [
          "{site}（{host}）是一个休闲羽毛球群自己用的报名和记账网站，由这个群的群主个人运营，不是公司，也不营利。网站的程序和服务器由网站维护者（见下面的「联系我们」）提供和维护；维护者能接触到网站的全部数据，只用于维护网站。本政策说明网站收集哪些信息、拿来做什么、谁能看到、保存多久。",
          "本网站不向华盛顿州提供服务。如果你住在华盛顿州，请不要注册或使用本网站。",
        ],
      },
      {
        h: "我们收集的信息",
        body: [
          [
            "申请入群：你填写的用户名、微信名和给群主的留言（选填）；以前用邮箱注册的成员还有邮箱。",
            "Google 登录：Google 账号编号、邮箱和头像链接。网站只请求最基本的登录信息，读不到你的 Gmail 邮件、通讯录、云端硬盘或其他 Google 数据。",
            "头像：默认用你 Google 账号的头像；你也可以上传一张照片（在手机上裁成小方图后再上传保存），或者选择不用头像。头像只给登录的成员看（排行榜和「最常一起打球」），没登录的访客看不到。",
            "活动记录：报名和取消、带的朋友（人数和你填的名字）、你填的到场和离开时间、出勤、应付金额和付款状态。",
            "球场排队（活动开了排队时）：成员填的球馆账号用户名和密码、登记的球场和排队情况，以及拍照登记时上传的球馆屏幕照片。照片会交给微软 Azure 上的 AI 模型识别，同时发过去的还有这场的球馆账号用户名（不含密码）；照片里可能有其他人的球馆用户名。照片本身不保存：识别完只留在你的手机网页上，直到你保存球场。",
            "付款通知：活动的收款人把 Venmo 收款通知邮件转发给网站，网站从中读出付款人名字、金额、备注和时间，用来自动对账，并保存邮件文字供收款人核对。付款人可能不是成员，例如替别人付款的人。Zelle 付款由收款人手动标记。网站碰不到你的银行或 Venmo 账户，也不保存你的银行卡号或 Venmo 密码。",
            "推送通知：你开启推送时，保存浏览器提供的推送地址和密钥。",
            "卡路里（自愿）：你在 iPhone 上点「读取」时，快捷指令从「健康」读出这场活动时间段内的活动能量，网站只保存一个总数，只有你自己看得到；你选择加入能量榜后，首页会显示你的名字和今年的总数。网站读不到「健康」里的其他数据。你可以在「个人信息」里删除某一场或全部卡路里记录。",
            "点赞：活动结束后，来打球的成员可以给一起打球的人点赞。网站保存谁给谁点了赞；收到赞的人和其他成员只看得到数量，看不到是谁点的。",
            "自付费用（自愿）：你可以在「我的花费」里记下自己在球馆另外付的钱，只有你自己看得到。",
            "抽奖（群里办抽奖时）：抽奖名单按入群先后列出成员的名字和头像，登录的成员都能看到；网站还记录谁在看、打气的次数、你是否选择不参加，以及中奖结果。在看和打气的记录在抽奖结束后删除。",
            "球场图：群主或管理员可以拍一张球馆张贴的场地平面图，交给微软 Azure 上的 AI 模型识别成球场图。照片识别完就删除，只保存画出来的图。",
            "技术信息：登录用的 Cookie；语言、外观等偏好只存在你自己的浏览器里。网站没有广告，也不用第三方统计工具；网站不跟踪你在其他网站上的活动，所以对浏览器的「请勿跟踪」（Do Not Track）信号不做区别处理。",
          ],
        ],
      },
      {
        h: "这些信息用来做什么",
        body: [
          "只用于运行这个羽毛球群：登录和识别成员、审核入群申请、发送专属链接和审核结果邮件、组织活动、计算和催收费用、自动对账、发送你开启的推送通知，以及维护网站。我们不出售个人信息，也不用于广告。",
        ],
      },
      {
        h: "谁能看到",
        body: [
          [
            "所有人（不用登录）：活动的时间、地点和报名人数，不显示谁报了名。如果群主或管理员打开了「没登录也能看」，首页还会显示公开的排行榜，包括成员名字和上榜的数字（比如出勤次数、在场时长），不含金额。这个开关默认关闭。",
            "其他成员：报了名的成员能看到这场活动的完整名单，包括名字、带的朋友和填的到场离开时间；活动开了球场排队时，还能看到大家填的球馆账号和密码（没经过审核就入群的新成员，要来打过一次球之后才看得到别人填的密码）。登录的成员能在首页看到群主或管理员公开的排行榜：出勤、在场时长、进步、连续、带朋友、排队帮忙、早报名的次数和名次，以及自愿加入的能量榜。别人看不到你的账单、邮箱或微信名。",
            "群主：能看到全部信息，用于管理活动和成员。",
            "管理员（如果群主任命了管理员）：能看到所有成员和入群申请的资料、普通成员和组织者的专属链接、所有活动的费用和付款，用于帮群主管理活动和成员。",
            "组织者（如果群主任命了组织者）：可以查看所有成员和入群申请的资料，包括邮箱、微信名、申请留言、群主写的备注名和出勤记录，但看不到成员的专属链接；还能看到他们自己负责的活动的费用和付款，以及付到他们自己 Venmo 或 Zelle 账户的收款。",
          ],
          "网站靠以下服务运行，它们只在提供服务所需的范围内处理数据：",
          [
            "Cloudflare：网站托管、数据库、接收转发的付款邮件，以及存放数据库备份：每次发布新版本前和每周各备份一次，备份加密后放在私有的存储空间里，保存 90 天。Cloudflare 会记录 IP 地址等访问日志。",
            "Google：Google 登录。",
            "Resend：发送审核结果和专属链接邮件。",
            "Telegram：给群主、管理员和组织者发活动通知，内容包括成员名字和金额。",
            "微软 Azure：拍照登记和球场图识别照片的 AI 模型。",
            "浏览器的推送服务（Apple、Google 或 Mozilla）：转送推送通知，内容是加密的。",
            "Google 表格：群主自己的 Google 表格每天同步一份网站数据，作为备份和对账用。",
            "Rally 总入口（badminton.llmat.dev，由同一位网站维护者运营）：如果这个群接入了总入口，你用 Google 登录总入口时，它会拿你的 Google 邮箱来问本网站，本网站回答你在这个群的名字、身份、未付金额和近期活动，让你在一个页面看到自己所有的群。不用总入口就不会有这一步。",
          ],
        ],
      },
      {
        h: "保存多久",
        body: [
          [
            "成员资料和活动记录：在你是成员期间一直保存。",
            "卡路里：保存到你自己删除为止，删除后立即从网站移除。",
            "球场排队：球馆账号（用户名和密码）、登记的球场和照片识别结果只在这场活动期间保存，活动结束 3 小时后（排队卡片消失时）全部删除。",
            "删除账号后（你自己删除，或群主删除成员）：登录、名字、微信名、邮箱、头像、申请留言、备注、推送订阅、卡路里、点赞和自付费用记录立即删除，你带的朋友的名字也一并删除。过去活动的名单、账单和收到的付款记录会留着，因为账目需要完整，但上面只显示「已删除成员」和成员编号。已经做好的数据库备份里的内容会随备份在 90 天内删除。",
            "登录状态保存 30 天；移到回收站的 Venmo 收款 30 天后永久删除；付款邮件的处理日志（只有时间和结果）120 天后删除；群主开启付款记录诊断后，还会保存邮件标题、付款人、交易编号、备注和处理步骤，仅群主可见，不保存完整邮件正文，诊断记录 14 天后删除；数据库备份 90 天后删除。",
          ],
        ],
      },
      {
        h: "你的选择",
        body: [
          "你可以在「个人信息」里修改名字和邮箱、开关推送通知、删除自己的卡路里记录，也可以随时退出 Google 登录。你还可以在「个人信息」里自己删除账号（有未付清的费用，或还在没结算的活动名单上时，要先处理完）。想查看、更正或删除你的个人信息，请联系网站维护者（见下面的「联系我们」）。",
          "本网站不面向 13 岁以下的儿童。",
        ],
      },
      {
        h: "政策变更",
        body: ["本政策更新时，会修改上面的日期；重要变化会在羽毛球群里通知。"],
      },
      {
        h: "联系我们",
        body: [`有关隐私或账号的问题，请联系网站维护者：${CONTACT}。`],
      },
    ],
  },
  "zh-TW": {
    updated: "最後更新：2026 年 11 月 18 日",
    sections: [
      {
        h: "這個網站是誰的",
        body: [
          "{site}（{host}）是一個休閒羽毛球群自己用的報名和記帳網站，由這個群的群主個人經營，不是公司，也不營利。網站的程式和伺服器由網站維護者（見下面的「聯絡我們」）提供和維護；維護者能接觸到網站的全部資料，只用於維護網站。本政策說明網站收集哪些資訊、拿來做什麼、誰能看到、保存多久。",
          "本網站不向華盛頓州提供服務。如果你住在華盛頓州，請不要註冊或使用本網站。",
        ],
      },
      {
        h: "我們收集的資訊",
        body: [
          [
            "申請入群：你填寫的使用者名稱、微信名和給群主的留言（選填）；以前用電子郵件註冊的成員還有電子郵件。",
            "Google 登入：Google 帳號編號、電子郵件和頭像連結。網站只請求最基本的登入資訊，讀不到你的 Gmail 郵件、聯絡人、雲端硬碟或其他 Google 資料。",
            "頭像：預設用你 Google 帳號的頭像；你也可以上傳一張照片（在手機上裁成小方圖後再上傳儲存），或者選擇不用頭像。頭像只給登入的成員看（排行榜和「最常一起打球」），沒登入的訪客看不到。",
            "活動記錄：報名和取消、帶的朋友（人數和你填的名字）、你填的到場和離開時間、出席、應付金額和付款狀態。",
            "球場排隊（活動開了排隊時）：成員填的球館帳號使用者名稱和密碼、登記的球場和排隊情況，以及拍照登記時上傳的球館螢幕照片。照片會交給微軟 Azure 上的 AI 模型辨識，同時傳過去的還有這場的球館帳號使用者名稱（不含密碼）；照片裡可能有其他人的球館使用者名稱。照片本身不保存：辨識完只留在你的手機網頁上，直到你儲存球場。",
            "付款通知：活動的收款人把 Venmo 收款通知郵件轉寄給網站，網站從中讀出付款人名字、金額、備註和時間，用來自動對帳，並保存郵件文字供收款人核對。付款人可能不是成員，例如替別人付款的人。Zelle 付款由收款人手動標記。網站碰不到你的銀行或 Venmo 帳戶，也不保存你的銀行卡號或 Venmo 密碼。",
            "推播通知：你開啟推播時，保存瀏覽器提供的推播位址和金鑰。",
            "卡路里（自願）：你在 iPhone 上點「讀取」時，捷徑從「健康」讀出這場活動時間段內的活動能量，網站只保存一個總數，只有你自己看得到；你選擇加入能量榜後，首頁會顯示你的名字和今年的總數。網站讀不到「健康」裡的其他資料。你可以在「個人資訊」裡刪除某一場或全部卡路里記錄。",
            "按讚：活動結束後，來打球的成員可以給一起打球的人按讚。網站保存誰給誰按了讚；收到讚的人和其他成員只看得到數量，看不到是誰按的。",
            "自付費用（自願）：你可以在「我的花費」裡記下自己在球館另外付的錢，只有你自己看得到。",
            "抽獎（群裡辦抽獎時）：抽獎名單按入群先後列出成員的名字和頭像，登入的成員都能看到；網站還記錄誰在看、打氣的次數、你是否選擇不參加，以及中獎結果。在看和打氣的記錄在抽獎結束後刪除。",
            "球場圖：群主或管理員可以拍一張球館張貼的場地平面圖，交給微軟 Azure 上的 AI 模型辨識成球場圖。照片辨識完就刪除，只保存畫出來的圖。",
            "技術資訊：登入用的 Cookie；語言、外觀等偏好只存在你自己的瀏覽器裡。網站沒有廣告，也不用第三方統計工具；網站不追蹤你在其他網站上的活動，所以對瀏覽器的「不要追蹤」（Do Not Track）訊號不做區別處理。",
          ],
        ],
      },
      {
        h: "這些資訊用來做什麼",
        body: [
          "只用於經營這個羽毛球群：登入和識別成員、審核入群申請、寄送專屬連結和審核結果郵件、組織活動、計算和催收費用、自動對帳、傳送你開啟的推播通知，以及維護網站。我們不出售個人資訊，也不用於廣告。",
        ],
      },
      {
        h: "誰能看到",
        body: [
          [
            "所有人（不用登入）：活動的時間、地點和報名人數，不顯示誰報了名。如果群主或管理員打開了「沒登入也能看」，首頁還會顯示公開的排行榜，包括成員名字和上榜的數字（比如出席次數、在場時長），不含金額。這個開關預設關閉。",
            "其他成員：報了名的成員能看到這場活動的完整名單，包括名字、帶的朋友和填的到場離開時間；活動開了球場排隊時，還能看到大家填的球館帳號和密碼（沒經過審核就入群的新成員，要來打過一次球之後才看得到別人填的密碼）。登入的成員能在首頁看到群主或管理員公開的排行榜：出席、在場時長、進步、連續、帶朋友、排隊幫忙、早報名的次數和名次，以及自願加入的能量榜。別人看不到你的帳單、電子郵件或微信名。",
            "群主：能看到全部資訊，用於管理活動和成員。",
            "管理員（如果群主任命了管理員）：能看到所有成員和入群申請的資料、一般成員和組織者的專屬連結、所有活動的費用和付款，用於幫群主管理活動和成員。",
            "組織者（如果群主任命了組織者）：可以查看所有成員和入群申請的資料，包括電子郵件、微信名、申請留言、群主寫的備註名和出席記錄，但看不到成員的專屬連結；還能看到他們自己負責的活動的費用和付款，以及付到他們自己 Venmo 或 Zelle 帳戶的收款。",
          ],
          "網站靠以下服務運作，它們只在提供服務所需的範圍內處理資料：",
          [
            "Cloudflare：網站託管、資料庫、接收轉寄的付款郵件，以及存放資料庫備份：每次發布新版本前和每週各備份一次，備份加密後放在私有的儲存空間裡，保存 90 天。Cloudflare 會記錄 IP 位址等存取日誌。",
            "Google：Google 登入。",
            "Resend：寄送審核結果和專屬連結郵件。",
            "Telegram：給群主、管理員和組織者傳送活動通知，內容包括成員名字和金額。",
            "微軟 Azure：拍照登記和球場圖辨識照片的 AI 模型。",
            "瀏覽器的推播服務（Apple、Google 或 Mozilla）：轉送推播通知，內容是加密的。",
            "Google 試算表：群主自己的 Google 試算表每天同步一份網站資料，作為備份和對帳用。",
            "Rally 總入口（badminton.llmat.dev，由同一位網站維護者經營）：如果這個群接入了總入口，你用 Google 登入總入口時，它會拿你的 Google 電子郵件來問本網站，本網站回答你在這個群的名字、身分、未付金額和近期活動，讓你在一個頁面看到自己所有的群。不用總入口就不會有這一步。",
          ],
        ],
      },
      {
        h: "保存多久",
        body: [
          [
            "成員資料和活動記錄：在你是成員期間一直保存。",
            "卡路里：保存到你自己刪除為止，刪除後立即從網站移除。",
            "球場排隊：球館帳號（使用者名稱和密碼）、登記的球場和照片辨識結果只在這場活動期間保存，活動結束 3 小時後（排隊卡片消失時）全部刪除。",
            "刪除帳號後（你自己刪除，或群主刪除成員）：登入、名字、微信名、電子郵件、頭像、申請留言、備註、推播訂閱、卡路里、按讚和自付費用記錄立即刪除，你帶的朋友的名字也一併刪除。過去活動的名單、帳單和收到的付款記錄會留著，因為帳目需要完整，但上面只顯示「已刪除成員」和成員編號。已經做好的資料庫備份裡的內容會隨備份在 90 天內刪除。",
            "登入狀態保存 30 天；移到資源回收筒的 Venmo 收款 30 天後永久刪除；付款郵件的處理日誌（只有時間和結果）120 天後刪除；群主開啟付款記錄診斷後，還會保存郵件標題、付款人、交易編號、備註和處理步驟，僅群主可見，不保存完整郵件正文，診斷記錄 14 天後刪除；資料庫備份 90 天後刪除。",
          ],
        ],
      },
      {
        h: "你的選擇",
        body: [
          "你可以在「個人資訊」裡修改名字和電子郵件、開關推播通知、刪除自己的卡路里記錄，也可以隨時登出 Google。你還可以在「個人資訊」裡自己刪除帳號（有未付清的費用，或還在沒結算的活動名單上時，要先處理完）。想查看、更正或刪除你的個人資訊，請聯絡網站維護者（見下面的「聯絡我們」）。",
          "本網站不以 13 歲以下的兒童為對象。",
        ],
      },
      {
        h: "政策變更",
        body: ["本政策更新時，會修改上面的日期；重要變化會在羽毛球群裡通知。"],
      },
      {
        h: "聯絡我們",
        body: [`有關隱私或帳號的問題，請聯絡網站維護者：${CONTACT}。`],
      },
    ],
  },
  en: {
    updated: "Last updated: November 18, 2026",
    sections: [
      {
        h: "Who runs this site",
        body: [
          "{site} ({host}) is the sign-up and bookkeeping site of a casual badminton group. It is run by the group's owner as an individual, not by a company, and makes no money. The site's software and servers are provided and maintained by the site maintainer (see \"Contact\" below), who can access all of the site's data and uses it only to keep the site running. This policy explains what the site collects, what it is used for, who can see it, and how long it is kept.",
          "This site does not offer its service in Washington State. If you live in Washington State, please do not sign up for or use this site.",
        ],
      },
      {
        h: "Information we collect",
        body: [
          [
            "When you apply to join: the username, WeChat name and optional note to the group owner that you enter, plus the email address of members who signed up by email before.",
            "When you sign in with Google: your Google account ID, email address and profile photo link. The site asks only for basic sign-in information and cannot read your Gmail, contacts, Drive or any other Google data.",
            "Profile photo: your Google account's photo by default; you can instead upload a photo (cropped to a small square on your phone before it is uploaded and stored), or choose none. Only signed-in members see it (on the leaderboards and in Played with most); visitors who aren't signed in don't.",
            "Event records: sign-ups and cancellations, friends you bring (how many, and any names you enter), the arrival and leaving times you enter, attendance, amounts owed and payment status.",
            "Court queue (when an event uses it): the gym account usernames and passwords members enter, the courts and queue places recorded, and photos of the gym's screen taken with Read from photo. Photos are read by an AI model on Microsoft Azure, together with the event's gym account usernames (never the passwords); a photo may show other people's gym usernames. The photo itself is never stored: after it is read it stays only on your phone's page until you save the courts.",
            "Payment notices: an event's payee forwards their Venmo payment notification emails to the site, which reads the payer's name, the amount, the note and the time to match payments automatically, and keeps the email text so the payee can check it. A payer may not be a member, for example someone paying on another person's behalf. Zelle payments are marked by hand by the payee. The site never touches your bank or Venmo account and stores no card numbers or Venmo passwords.",
            "Push notifications: if you turn them on, the push address and keys your browser provides.",
            'Calories (optional): when you tap "Read" on an iPhone, a shortcut reads the active energy during that event from Apple Health and the site keeps only the total, visible only to you. If you join the Energy board, the home page shows your name and this year\'s total. The site can\'t read anything else in Apple Health. You can delete one event\'s calories or all of them under "Profile".',
            "Likes: after an event, members who played can like others who played with them. The site keeps who liked whom; the person liked and other members only see the count, never who gave it.",
            'Own costs (optional): under "My spending" you can note what you paid at the venue yourself. Only you can see it.',
            "Prize draws (when the group holds one): the list shows members' names and avatars in the order they joined, to signed-in members; the site also records who is watching, how often they cheered, whether you chose not to take part, and the winners. Watching and cheering records are deleted when the draw is over.",
            "Court maps: the group owner or an admin can photograph the floor plan posted at a venue and have an AI model on Microsoft Azure turn it into a court map. The photo is deleted once it has been read; only the drawn map is kept.",
            "Technical information: cookies that keep you signed in. Preferences such as language and appearance stay in your own browser. The site has no ads and no third-party analytics. It does not track you across other sites, so it does not respond differently to a browser's Do Not Track signal.",
          ],
        ],
      },
      {
        h: "How it is used",
        body: [
          "Only to run the badminton group: signing in and recognizing members, reviewing applications, emailing personal links and application results, organizing events, working out and collecting costs, matching payments, sending the push notifications you turned on, and keeping the site running. We do not sell personal information or use it for advertising.",
        ],
      },
      {
        h: "Who can see it",
        body: [
          [
            "Anyone, without signing in: each event's time, place and number of sign-ups, but not who signed up. If the group owner or an admin turns on “Visible without signing in”, the home page also shows the public leaderboards, with members' names and their numbers (such as times attended or hours played), never amounts. This switch is off by default.",
            "Other members: members signed up for an event see its full roster, with names, the friends each person brings and the arrival and leaving times entered; when the event uses the court queue, they also see the gym accounts and passwords everyone entered (a new member who joined without being approved sees the passwords others entered only after playing one event). Signed-in members see the leaderboards the group owner or an admin made public on the home page: ranks and counts for attendance, hours played, improvement, streaks, bringing friends, helping with the court queue and signing up early, and the opt-in Energy board. Nobody else sees your bills, email address or WeChat name.",
            "The group owner: everything, to manage events and members.",
            "Admins, if the group owner appoints any: the details of all members and applicants, the personal links of members and organizers, and every event's costs and payments, to help manage events and members.",
            "Organizers, if the group owner appoints any: the details of all members and applicants, including email addresses, WeChat names, application notes, the owner's notes and attendance, but not members' personal links; and, for the events they run, the costs and payments, plus the payments made to their own Venmo or Zelle account.",
          ],
          "The site runs on these services, which handle data only as needed to provide their service:",
          [
            "Cloudflare: hosting, the database, receiving forwarded payment emails, and storing database backups: one before each new version of the site is released and one every week, encrypted, in private storage, kept for 90 days. Cloudflare keeps access logs such as IP addresses.",
            "Google: Google sign-in.",
            "Resend: sending application-result and personal-link emails.",
            "Telegram: event notifications to the group owner, admins and organizers, which include member names and amounts.",
            "Microsoft Azure: the AI model that reads photos for Read from photo and for court maps.",
            "Your browser's push service (Apple, Google or Mozilla): delivers push notifications, whose content is encrypted.",
            "Google Sheets: the group owner's own Google Sheet receives a daily copy of the site's data, as a backup and for bookkeeping.",
            "Rally hub (badminton.llmat.dev, run by the same site maintainer): if this group is connected to the hub, then when you sign in to the hub with Google it asks this site about your Google email address, and this site answers with your name, role, unpaid amount and upcoming events in this group, so that you see all your groups on one page. If you do not use the hub, this never happens.",
          ],
        ],
      },
      {
        h: "How long it is kept",
        body: [
          [
            "Member details and event records: for as long as you are a member.",
            "Calories: until you delete them; deleting removes them from the site at once.",
            "Court queue: gym accounts (usernames and passwords), recorded courts and what photos showed are kept only for the event, and all deleted 3 hours after it ends (when the queue card goes away).",
            'When an account is deleted (by you, or by the group owner): the sign-in, name, WeChat name, email address, avatar, application message, notes, push subscriptions, calories, likes and own-cost records are removed at once, and so are the names of friends you brought. Past rosters, bills and records of payments received stay, because the accounts must stay complete, but they show only "Deleted member" and the member number. What is already in a database backup goes when that backup is deleted, within 90 days.',
            "Sign-ins last 30 days. Venmo payments moved to the trash are deleted for good after 30 days. The payment email log (time and outcome only) is deleted after 120 days. If the Owner enables payment diagnostics, email subjects, payer names, transaction IDs, notes and processing steps are also stored, visible only to the Owner; full email bodies are not retained, and diagnostic records are deleted after 14 days. Database backups are deleted after 90 days.",
          ],
        ],
      },
      {
        h: "Your choices",
        body: [
          'You can change your name and email address and turn push notifications on or off and delete your calorie records under "Profile", and sign out of Google at any time. You can also delete your account yourself under "Profile" (first settle anything you owe and any event that is not billed yet). To see, correct or delete your personal information, contact the site maintainer (see "Contact" below).',
          "This site is not meant for children under 13.",
        ],
      },
      {
        h: "Changes to this policy",
        body: [
          "When this policy changes, the date at the top changes too; important changes are announced in the badminton group.",
        ],
      },
      {
        h: "Contact",
        body: [`For questions about privacy or your account, contact the site maintainer: ${CONTACT}.`],
      },
    ],
  },
};

export const TERMS: Record<Lang, LegalDoc> = {
  "zh-CN": {
    updated: "最后更新：2026 年 11 月 10 日",
    sections: [
      {
        h: "服务是什么",
        body: [
          "{site} 是羽毛球群成员报名活动、查看名单、出勤和费用的工具，由群主个人免费提供。使用本网站即表示你同意这些条款。",
          "本网站不向华盛顿州提供服务。如果你住在华盛顿州，请不要注册或使用本网站。",
        ],
      },
      {
        h: "账号",
        body: [
          [
            "每人一个账号，请用群里能认出你的名字，并提供真实的资料。",
            "请保管好你用来登录的 Google 账号：能登录它的人就能用你的身份报名和取消。以前发给你的专属链接也一样，请不要转发；如果泄露了，请联系群主。",
            "不要冒用他人身份、反复提交申请或干扰网站运行。群主可以停用或删除违反这些条款的账号。",
          ],
        ],
      },
      {
        h: "报名和费用",
        body: [
          [
            "活动的时间、地点、名额和带朋友的上限以网站上的信息为准。",
            "报名截止前（活动没设截止时间的，到活动结束前）可以随时修改或取消报名。截止后名单锁定，需要修改请联系活动的组织者。",
            "活动开了球场排队时，你填的球馆账号必须是你自己有权使用、也同意分享给这场报名的人的；它的密码这场报名的人都能看到，请不要填在其他地方也用的密码。共享账号是否符合球馆的规定，由你自己负责。",
            "最终名单上的人（包括朋友）平摊场地费，实际到场的人再平摊球费。报了名没来，仍要付场地费。",
            "你带的朋友的费用算在你的账单上。取消报名时，你名下的朋友会一起取消。",
            "活动取消不收费。每个人的金额以结算后网站上的账单为准。",
          ],
        ],
      },
      {
        h: "付款",
        body: [
          "网站不经手任何钱。请按账单上的说明，用 Venmo 或 Zelle 直接付给这场活动的收款人；网站只记录付款状态。自动对账可能出错，是否付清以收款人的确认为准，付错或多付请联系收款人。使用 Venmo 和 Zelle 时还要遵守它们各自的条款。",
        ],
      },
      {
        h: "参加活动的风险",
        body: [
          "羽毛球是体育运动，有受伤的风险。参加活动是你自愿的，请量力而行，并遵守场馆的规定。在法律允许的范围内，群主和组织者只负责组织报名和记账，不对活动中的受伤、财物丢失或损坏承担责任。",
        ],
      },
      {
        h: "服务按现状提供",
        body: [
          "本网站免费提供，可能有错误，也可能临时中断。群主可以根据群里的需要调整功能，或停止提供服务；重要变化会在网站或羽毛球群里通知。",
        ],
      },
      {
        h: "条款变更",
        body: ["条款更新时会修改上面的日期。更新后继续使用本网站，即表示你同意新的条款。"],
      },
      {
        h: "联系我们",
        body: [`如对这些条款有疑问，请联系网站维护者：${CONTACT}。`],
      },
    ],
  },
  "zh-TW": {
    updated: "最後更新：2026 年 11 月 10 日",
    sections: [
      {
        h: "服務是什麼",
        body: [
          "{site} 是羽毛球群成員報名活動、查看名單、出席和費用的工具，由群主個人免費提供。使用本網站即表示你同意這些條款。",
          "本網站不向華盛頓州提供服務。如果你住在華盛頓州，請不要註冊或使用本網站。",
        ],
      },
      {
        h: "帳號",
        body: [
          [
            "每人一個帳號，請用群裡能認出你的名字，並提供真實的資料。",
            "請保管好你用來登入的 Google 帳號：能登入它的人就能用你的身分報名和取消。以前傳給你的專屬連結也一樣，請不要轉傳；如果外洩了，請聯絡群主。",
            "不要冒用他人身分、反覆提交申請或干擾網站運作。群主可以停用或刪除違反這些條款的帳號。",
          ],
        ],
      },
      {
        h: "報名和費用",
        body: [
          [
            "活動的時間、地點、名額和帶朋友的上限以網站上的資訊為準。",
            "報名截止前（活動沒設截止時間的，到活動結束前）可以隨時修改或取消報名。截止後名單鎖定，需要修改請聯絡活動的組織者。",
            "活動開了球場排隊時，你填的球館帳號必須是你自己有權使用、也同意分享給這場報名的人的；它的密碼這場報名的人都能看到，請不要填在其他地方也用的密碼。共享帳號是否符合球館的規定，由你自己負責。",
            "最終名單上的人（包括朋友）平攤場地費，實際到場的人再平攤球費。報了名沒來，仍要付場地費。",
            "你帶的朋友的費用算在你的帳單上。取消報名時，你名下的朋友會一起取消。",
            "活動取消不收費。每個人的金額以結算後網站上的帳單為準。",
          ],
        ],
      },
      {
        h: "付款",
        body: [
          "網站不經手任何錢。請按帳單上的說明，用 Venmo 或 Zelle 直接付給這場活動的收款人；網站只記錄付款狀態。自動對帳可能出錯，是否付清以收款人的確認為準，付錯或多付請聯絡收款人。使用 Venmo 和 Zelle 時還要遵守它們各自的條款。",
        ],
      },
      {
        h: "參加活動的風險",
        body: [
          "羽毛球是體育運動，有受傷的風險。參加活動是你自願的，請量力而行，並遵守場館的規定。在法律允許的範圍內，群主和組織者只負責組織報名和記帳，不對活動中的受傷、財物遺失或損壞承擔責任。",
        ],
      },
      {
        h: "服務按現狀提供",
        body: [
          "本網站免費提供，可能有錯誤，也可能暫時中斷。群主可以根據群裡的需要調整功能，或停止提供服務；重要變化會在網站或羽毛球群裡通知。",
        ],
      },
      {
        h: "條款變更",
        body: ["條款更新時會修改上面的日期。更新後繼續使用本網站，即表示你同意新的條款。"],
      },
      {
        h: "聯絡我們",
        body: [`如對這些條款有疑問，請聯絡網站維護者：${CONTACT}。`],
      },
    ],
  },
  en: {
    updated: "Last updated: November 10, 2026",
    sections: [
      {
        h: "What the service is",
        body: [
          "{site} is where members of a badminton group sign up for events and see rosters, attendance and costs. The group owner provides it for free as an individual. By using the site you agree to these terms.",
          "This site does not offer its service in Washington State. If you live in Washington State, please do not sign up for or use this site.",
        ],
      },
      {
        h: "Your account",
        body: [
          [
            "One account per person. Use a name the group recognizes you by, and give accurate details.",
            "Keep the Google account you sign in with safe: anyone who can sign in to it can sign up and cancel as you. The same goes for any personal link you were sent before: don't share it, and if it gets out, contact the group owner.",
            "Don't pretend to be someone else, submit applications over and over, or interfere with the site. The group owner may deactivate or delete accounts that break these terms.",
          ],
        ],
      },
      {
        h: "Sign-ups and costs",
        body: [
          [
            "Event times, places, spots and the limit on friends are as shown on the site.",
            "You can change or cancel your sign-up any time before the sign-up deadline (or, for an event without one, before it ends). After the deadline the roster is locked; to change it, contact the event's organizer.",
            "When an event uses the court queue, any gym account you enter must be one you may use and agree to share with the people signed up for that event; they can all see its password, so don't enter a password you use anywhere else. Whether sharing the account is allowed by the gym's rules is your own responsibility.",
            "Everyone on the final roster, friends included, splits the court fee, and everyone who actually comes also splits the cost of shuttlecocks. If you sign up and don't come, you still pay your share of the court fee.",
            "Friends you bring are billed to you. If you cancel, the friends under your name are cancelled too.",
            "A cancelled event costs nothing. What each person owes is the bill shown on the site after the event is settled.",
          ],
        ],
      },
      {
        h: "Payments",
        body: [
          "The site never handles money. Pay the event's payee directly with Venmo or Zelle as your bill explains; the site only records whether you have paid. Automatic matching can make mistakes, so the payee's confirmation is what counts. If you paid the wrong amount or paid twice, contact the payee. Venmo and Zelle have their own terms, which also apply.",
        ],
      },
      {
        h: "Playing at your own risk",
        body: [
          "Badminton is a sport, and you can get hurt. You take part of your own free will; play within your limits and follow the venue's rules. To the extent the law allows, the group owner and organizers only arrange sign-ups and bookkeeping, and are not responsible for injuries or for lost or damaged belongings at events.",
        ],
      },
      {
        h: "Provided as is",
        body: [
          "The site is free and may have mistakes or be unavailable for a while. The group owner may change its features or stop providing it as the group needs; important changes are announced on the site or in the badminton group.",
        ],
      },
      {
        h: "Changes to these terms",
        body: [
          "When these terms change, the date at the top changes too. Using the site after an update means you accept the new terms.",
        ],
      },
      {
        h: "Contact",
        body: [`For questions about these terms, contact the site maintainer: ${CONTACT}.`],
      },
    ],
  },
};
