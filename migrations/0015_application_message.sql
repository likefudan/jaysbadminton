-- 给管理员的留言: optional, written by the applicant (e.g. who introduced them). The older
-- applicant_name / wechat_account columns stay for applications made before this.
ALTER TABLE members ADD COLUMN application_message TEXT;
