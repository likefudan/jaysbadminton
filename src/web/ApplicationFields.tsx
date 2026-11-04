import { MESSAGE_MAX } from "../shared/rules";
import { Field } from "./components";
import { t } from "./i18n";

/** The Google sign-up's application form: two names and an optional note. */
export function ApplicationFields(props: {
  username: string;
  setUsername: (v: string) => void;
  nickname: string;
  setNickname: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
}) {
  return (
    <>
      <Field
        label={t("用户名")}
        value={props.username}
        onInput={props.setUsername}
        hint={t("报名名单上显示的名字，不能和别人重复")}
        autocomplete="nickname"
      />
      <Field
        label={t("微信名")}
        value={props.nickname}
        onInput={props.setNickname}
        hint={t("群昵称或微信号都可以，群主能认出你就行")}
      />
      <label class="field">
        <span>{t("给群主的留言（选填）")}</span>
        <textarea
          value={props.message}
          maxLength={MESSAGE_MAX}
          placeholder={t("比如谁介绍你来的")}
          onInput={(e) => props.setMessage((e.target as HTMLTextAreaElement).value)}
        />
      </label>
    </>
  );
}
