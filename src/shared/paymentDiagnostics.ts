export interface PaymentDiagnosticStep {
  stage: string;
  label: string;
  status: "processing" | "passed" | "failed" | "warning";
  detail?: string;
  actual?: string;
  expected?: string;
}

export interface PaymentDiagnosticRecord {
  id: number;
  receivedAt: string;
  outcome: string;
  subject: string;
  txnId: string | null;
  payerName: string | null;
  note: string | null;
  steps: PaymentDiagnosticStep[];
}

export interface PaymentDiagnosticsResponse {
  enabled: boolean;
  records: PaymentDiagnosticRecord[];
  nextBefore: number | null;
}
