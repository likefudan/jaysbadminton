// The 管理页 and its texts, downloaded only by whoever opens /admin (main.tsx): members never need them.
import { ADMIN_MESSAGES } from "../adminMessages";
import { addMessages } from "../lang";

addMessages(ADMIN_MESSAGES);

export { Admin } from "./Admin";
export { AdminSetup } from "./AdminSetup";
