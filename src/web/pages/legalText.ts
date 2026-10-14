import type { Lang } from "../lang";

/**
 * The privacy policy and terms, written out in each language rather than looked up sentence by
 * sentence in messages.ts: legal text reads better kept whole. A string is a paragraph, an array
 * is a bulleted list. Change all three languages together, and the date with them.
 */
export interface LegalDoc {
  updated: string;
  sections: { h: string; body: (string | string[])[] }[];
}

const CONTACT = "likefudan@gmail.com";

export const PRIVACY: Record<Lang, LegalDoc> = {
  "zh-CN": {
    updated: "最后更新：2026 年 10 月 12 日",
    sections: [
      {
        h: "这个网站是谁的",
        body: [
          "Jay's Badminton（jaysbadminton.llmat.dev）是一个休闲羽毛球群自己用的报名和记账网站，由群主个人运营，不是公司，也不营利。本政策说明网站收集哪些信息、拿来做什么、谁能看到、保存多久。",
        ],
      },
      {
        h: "我们收集的信息",
        body: [
          [
            "申请入群：你填写的用户名、微信名和给群主的留言（选填）；用邮箱注册时还有你的邮箱。",
            "Google 登录：Google 账号编号、邮箱和头像链接。网站只请求最基本的登录信息，读不到你的 Gmail 邮件、通讯录、云端硬盘或其他 Google 数据。",
            "活动记录：报名和取消、带的朋友（人数和你填的名字）、出勤、应付金额和付款状态。",
            "付款通知：活动的收款人把 Venmo 收款通知邮件转发给网站，网站从中读出付款人名字、金额、备注和时间，用来自动对账，并保存邮件文字供收款人核对。付款人可能不是成员，例如替别人付款的人。Zelle 付款由收款人手动标记。网站碰不到你的银行或 Venmo 账户，也不保存卡号或密码。",
            "推送通知：你开启推送时，保存浏览器提供的推送地址和密钥。",
            "技术信息：登录用的 Cookie；语言、外观等偏好只存在你自己的浏览器里。网站没有广告，也不用第三方统计工具。",
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
            "所有人（不用登录）：活动的时间、地点和报名人数，不显示谁报了名。如果群主打开了出勤排行榜，首页会显示成员名字和出勤次数，不含金额。",
            "其他成员：报了名的成员能看到这场活动的完整名单，包括名字和带的朋友。别人看不到你的账单、邮箱或微信名。",
            "群主：能看到全部信息，用于管理活动和成员。",
            "组织者（如果群主任命了组织者）：可以查看所有成员和入群申请的资料，包括邮箱、微信名、申请留言、群主写的备注名和出勤记录，但看不到成员的专属链接；还能看到他们自己负责的活动的费用和付款，以及付到他们自己 Venmo 或 Zelle 账户的收款。",
          ],
          "网站靠以下服务运行，它们只在提供服务所需的范围内处理数据：",
          [
            "Cloudflare：网站托管、数据库、接收转发的付款邮件，以及申请和找回链接时的人机验证（Turnstile）。Cloudflare 会记录 IP 地址等访问日志。",
            "Google：Google 登录。",
            "Resend：发送审核结果和专属链接邮件。",
            "Telegram：给群主和组织者发活动通知，内容包括成员名字和金额。",
            "浏览器的推送服务（Apple、Google 或 Mozilla）：转送推送通知，内容是加密的。",
            "Google 表格：群主自己的 Google 表格每天同步一份网站数据，作为备份和对账用。",
            "GitHub：每次发布新版本前备份一次数据库，备份保存 90 天。",
          ],
        ],
      },
      {
        h: "保存多久",
        body: [
          [
            "成员资料和活动记录：在你是成员期间一直保存。",
            "删除成员后：专属链接、Google 账号关联和推送订阅立即删除；你的名字会加上成员编号留在过去的名单和账单里，因为账目需要完整。",
            "登录状态保存 30 天；移到回收站的 Venmo 收款 30 天后永久删除；付款邮件的处理日志（只有时间和结果）120 天后删除；群主开启付款记录诊断后，还会保存邮件标题、付款人、交易编号、备注和处理步骤，仅群主可见，不保存完整邮件正文，诊断记录 14 天后删除；数据库备份 90 天后删除。",
          ],
        ],
      },
      {
        h: "你的选择",
        body: [
          "你可以在「个人信息」里修改名字和邮箱、开关推送通知，也可以随时退出 Google 登录。想查看、更正或删除你的个人信息，请联系网站维护者（见下面的「联系我们」）。",
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
    updated: "最後更新：2026 年 10 月 12 日",
    sections: [
      {
        h: "這個網站是誰的",
        body: [
          "Jay's Badminton（jaysbadminton.llmat.dev）是一個休閒羽毛球群自己用的報名和記帳網站，由群主個人經營，不是公司，也不營利。本政策說明網站收集哪些資訊、拿來做什麼、誰能看到、保存多久。",
        ],
      },
      {
        h: "我們收集的資訊",
        body: [
          [
            "申請入群：你填寫的使用者名稱、微信名和給群主的留言（選填）；用電子郵件註冊時還有你的電子郵件。",
            "Google 登入：Google 帳號編號、電子郵件和頭像連結。網站只請求最基本的登入資訊，讀不到你的 Gmail 郵件、聯絡人、雲端硬碟或其他 Google 資料。",
            "活動記錄：報名和取消、帶的朋友（人數和你填的名字）、出席、應付金額和付款狀態。",
            "付款通知：活動的收款人把 Venmo 收款通知郵件轉寄給網站，網站從中讀出付款人名字、金額、備註和時間，用來自動對帳，並保存郵件文字供收款人核對。付款人可能不是成員，例如替別人付款的人。Zelle 付款由收款人手動標記。網站碰不到你的銀行或 Venmo 帳戶，也不保存卡號或密碼。",
            "推播通知：你開啟推播時，保存瀏覽器提供的推播位址和金鑰。",
            "技術資訊：登入用的 Cookie；語言、外觀等偏好只存在你自己的瀏覽器裡。網站沒有廣告，也不用第三方統計工具。",
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
            "所有人（不用登入）：活動的時間、地點和報名人數，不顯示誰報了名。如果群主打開了出席排行榜，首頁會顯示成員名字和出席次數，不含金額。",
            "其他成員：報了名的成員能看到這場活動的完整名單，包括名字和帶的朋友。別人看不到你的帳單、電子郵件或微信名。",
            "群主：能看到全部資訊，用於管理活動和成員。",
            "組織者（如果群主任命了組織者）：可以查看所有成員和入群申請的資料，包括電子郵件、微信名、申請留言、群主寫的備註名和出席記錄，但看不到成員的專屬連結；還能看到他們自己負責的活動的費用和付款，以及付到他們自己 Venmo 或 Zelle 帳戶的收款。",
          ],
          "網站靠以下服務運作，它們只在提供服務所需的範圍內處理資料：",
          [
            "Cloudflare：網站託管、資料庫、接收轉寄的付款郵件，以及申請和找回連結時的人機驗證（Turnstile）。Cloudflare 會記錄 IP 位址等存取日誌。",
            "Google：Google 登入。",
            "Resend：寄送審核結果和專屬連結郵件。",
            "Telegram：給群主和組織者傳送活動通知，內容包括成員名字和金額。",
            "瀏覽器的推播服務（Apple、Google 或 Mozilla）：轉送推播通知，內容是加密的。",
            "Google 試算表：群主自己的 Google 試算表每天同步一份網站資料，作為備份和對帳用。",
            "GitHub：每次發布新版本前備份一次資料庫，備份保存 90 天。",
          ],
        ],
      },
      {
        h: "保存多久",
        body: [
          [
            "成員資料和活動記錄：在你是成員期間一直保存。",
            "刪除成員後：專屬連結、Google 帳號連結和推播訂閱立即刪除；你的名字會加上成員編號留在過去的名單和帳單裡，因為帳目需要完整。",
            "登入狀態保存 30 天；移到資源回收筒的 Venmo 收款 30 天後永久刪除；付款郵件的處理日誌（只有時間和結果）120 天後刪除；群主開啟付款記錄診斷後，還會保存郵件標題、付款人、交易編號、備註和處理步驟，僅群主可見，不保存完整郵件正文，診斷記錄 14 天後刪除；資料庫備份 90 天後刪除。",
          ],
        ],
      },
      {
        h: "你的選擇",
        body: [
          "你可以在「個人資訊」裡修改名字和電子郵件、開關推播通知，也可以隨時登出 Google。想查看、更正或刪除你的個人資訊，請聯絡網站維護者（見下面的「聯絡我們」）。",
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
    updated: "Last updated: October 12, 2026",
    sections: [
      {
        h: "Who runs this site",
        body: [
          "Jay's Badminton (jaysbadminton.llmat.dev) is the sign-up and bookkeeping site of a casual badminton group. It is run by the group owner as an individual, not by a company, and makes no money. This policy explains what the site collects, what it is used for, who can see it, and how long it is kept.",
        ],
      },
      {
        h: "Information we collect",
        body: [
          [
            "When you apply to join: the username, WeChat name and optional note to the group owner that you enter, plus your email address if you sign up by email.",
            "When you sign in with Google: your Google account ID, email address and profile photo link. The site asks only for basic sign-in information and cannot read your Gmail, contacts, Drive or any other Google data.",
            "Event records: sign-ups and cancellations, friends you bring (how many, and any names you enter), attendance, amounts owed and payment status.",
            "Payment notices: an event's payee forwards their Venmo payment notification emails to the site, which reads the payer's name, the amount, the note and the time to match payments automatically, and keeps the email text so the payee can check it. A payer may not be a member, for example someone paying on another person's behalf. Zelle payments are marked by hand by the payee. The site never touches your bank or Venmo account and stores no card numbers or passwords.",
            "Push notifications: if you turn them on, the push address and keys your browser provides.",
            "Technical information: cookies that keep you signed in. Preferences such as language and appearance stay in your own browser. The site has no ads and no third-party analytics.",
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
            "Anyone, without signing in: each event's time, place and number of sign-ups, but not who signed up. If the group owner turns on the attendance leaderboard, the home page shows members' names and how many times they came, with no amounts.",
            "Other members: members signed up for an event see its full roster, with names and the friends each person brings. Nobody else sees your bills, email address or WeChat name.",
            "The group owner: everything, to manage events and members.",
            "Organizers, if the group owner appoints any: the details of all members and applicants, including email addresses, WeChat names, application notes, the owner's notes and attendance, but not members' personal links; and, for the events they run, the costs and payments, plus the payments made to their own Venmo or Zelle account.",
          ],
          "The site runs on these services, which handle data only as needed to provide their service:",
          [
            "Cloudflare: hosting, the database, receiving forwarded payment emails, and the human check (Turnstile) on the join and recover-link forms. Cloudflare keeps access logs such as IP addresses.",
            "Google: Google sign-in.",
            "Resend: sending application-result and personal-link emails.",
            "Telegram: event notifications to the group owner and organizers, which include member names and amounts.",
            "Your browser's push service (Apple, Google or Mozilla): delivers push notifications, whose content is encrypted.",
            "Google Sheets: the group owner's own Google Sheet receives a daily copy of the site's data, as a backup and for bookkeeping.",
            "GitHub: a backup of the database is made before each new version of the site is released, and kept for 90 days.",
          ],
        ],
      },
      {
        h: "How long it is kept",
        body: [
          [
            "Member details and event records: for as long as you are a member.",
            "When a member is deleted: their personal link, Google account link and push subscriptions are removed at once; their name stays on past rosters and bills with their member number added, because the accounts must stay complete.",
            "Sign-ins last 30 days. Venmo payments moved to the trash are deleted for good after 30 days. The payment email log (time and outcome only) is deleted after 120 days. If the Owner enables payment diagnostics, email subjects, payer names, transaction IDs, notes and processing steps are also stored, visible only to the Owner; full email bodies are not retained, and diagnostic records are deleted after 14 days. Database backups are deleted after 90 days.",
          ],
        ],
      },
      {
        h: "Your choices",
        body: [
          'You can change your name and email address and turn push notifications on or off under "Profile", and sign out of Google at any time. To see, correct or delete your personal information, contact the site maintainer (see "Contact" below).',
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
    updated: "最后更新：2026 年 10 月 12 日",
    sections: [
      {
        h: "服务是什么",
        body: [
          "Jay's Badminton 是羽毛球群成员报名活动、查看名单、出勤和费用的工具，由群主个人免费提供。使用本网站即表示你同意这些条款。",
        ],
      },
      {
        h: "账号",
        body: [
          [
            "每人一个账号，请用群里能认出你的名字，并提供真实的资料。",
            "你的专属链接相当于密码：拿到链接的人可以用你的身份报名和取消。请不要转发；如果泄露了，请联系群主重新生成。",
            "不要冒用他人身份、反复提交申请或干扰网站运行。群主可以停用或删除违反这些条款的账号。",
          ],
        ],
      },
      {
        h: "报名和费用",
        body: [
          [
            "活动的时间、地点、名额和带朋友的上限以网站上的信息为准。",
            "截止前可以随时修改或取消报名。截止后名单锁定，需要修改请联系活动的组织者。",
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
    updated: "最後更新：2026 年 10 月 12 日",
    sections: [
      {
        h: "服務是什麼",
        body: [
          "Jay's Badminton 是羽毛球群成員報名活動、查看名單、出席和費用的工具，由群主個人免費提供。使用本網站即表示你同意這些條款。",
        ],
      },
      {
        h: "帳號",
        body: [
          [
            "每人一個帳號，請用群裡能認出你的名字，並提供真實的資料。",
            "你的專屬連結相當於密碼：拿到連結的人可以用你的身分報名和取消。請不要轉傳；如果外洩了，請聯絡群主重新產生。",
            "不要冒用他人身分、反覆提交申請或干擾網站運作。群主可以停用或刪除違反這些條款的帳號。",
          ],
        ],
      },
      {
        h: "報名和費用",
        body: [
          [
            "活動的時間、地點、名額和帶朋友的上限以網站上的資訊為準。",
            "截止前可以隨時修改或取消報名。截止後名單鎖定，需要修改請聯絡活動的組織者。",
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
    updated: "Last updated: October 12, 2026",
    sections: [
      {
        h: "What the service is",
        body: [
          "Jay's Badminton is where members of a badminton group sign up for events and see rosters, attendance and costs. The group owner provides it for free as an individual. By using the site you agree to these terms.",
        ],
      },
      {
        h: "Your account",
        body: [
          [
            "One account per person. Use a name the group recognizes you by, and give accurate details.",
            "Your personal link works like a password: anyone who has it can sign up and cancel as you. Don't share it; if it gets out, ask the group owner to make a new one.",
            "Don't pretend to be someone else, submit applications over and over, or interfere with the site. The group owner may deactivate or delete accounts that break these terms.",
          ],
        ],
      },
      {
        h: "Sign-ups and costs",
        body: [
          [
            "Event times, places, spots and the limit on friends are as shown on the site.",
            "You can change or cancel your sign-up any time before the deadline. After the deadline the roster is locked; to change it, contact the event's organizer.",
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
