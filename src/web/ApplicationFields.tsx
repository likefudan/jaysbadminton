import { MESSAGE_MAX } from "../shared/rules";
import { Field } from "./components";

/** The application form, the same for 申请加入 and the Google sign-up: two names and an optional note. */
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
      <Field label="用户名" value={props.username} onInput={props.setUsername} hint="报名名单上显示的名字，不能和别人重复" autocomplete="nickname" />
      <Field label="微信名" value={props.nickname} onInput={props.setNickname} hint="群昵称或微信号都可以，管理员能认出你就行" />
      <label class="field">
        <span>给管理员的留言（选填）</span>
        <textarea
          value={props.message}
          maxLength={MESSAGE_MAX}
          placeholder="比如谁介绍你来的"
          onInput={(e) => props.setMessage((e.target as HTMLTextAreaElement).value)}
        />
      </label>
    </>
  );
}
