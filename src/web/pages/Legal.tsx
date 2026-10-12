import { Card, Page } from "../components";
import { currentLang, t } from "../i18n";
import { type LegalDoc, PRIVACY, TERMS } from "./legalText";

function LegalPage(props: { title: string; doc: LegalDoc }) {
  return (
    <Page title={props.title} subtitle={props.doc.updated}>
      <Card>
        {props.doc.sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.body.map((b, i) =>
              typeof b === "string" ? (
                <p key={i}>{b}</p>
              ) : (
                <ul key={i} class="legal-list">
                  {b.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
      </Card>
    </Page>
  );
}

export const Privacy = () => <LegalPage title={t("隐私政策")} doc={PRIVACY[currentLang()]} />;

export const Terms = () => <LegalPage title={t("使用条款")} doc={TERMS[currentLang()]} />;
