"use client";

import { useFormState, useFormStatus } from "react-dom";
import { uploadReturns } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Importando…" : "Importar"}</button>;
}

export function ReturnsUploadForm() {
  const [report, action] = useFormState(uploadReturns, null);
  return <>
    <form action={action} className="upload-form">
      <label>
        <span>Arquivo .xlsx</span>
        <input type="file" name="file" accept=".xlsx" required />
      </label>
      <label>
        <span>Loja (para aba sem nome de loja)</span>
        <select name="account" defaultValue="">
          <option value="">Usar nomes das abas</option>
          <option value="Donacor">Donacor</option>
          <option value="Aliver">Aliver</option>
          <option value="Jacartta">Jacartta</option>
        </select>
      </label>
      <Submit />
    </form>
    {report && <div role={report.failure ? "alert" : "status"} aria-live="polite">
      <p className={report.failure ? "form-error" : "muted"}>
        {report.failure ?? `Importação concluída: ${report.rowsRead} linhas lidas, ${report.rowsWritten} gravadas, ${report.rowsRejected} descartadas.`}
        {report.failure && report.rowsWritten > 0 ? ` ${report.rowsWritten} linhas já foram gravadas; reenvie o arquivo para concluir.` : ""}
      </p>
      {report.errors.length > 0 && <details>
        <summary>{report.errors.length} avisos da importação</summary>
        <ul className="muted">{report.errors.slice(0, 30).map((error, index) =>
          <li key={index}>Aba {error.sheet}, linha {error.row}: {error.message}</li>
        )}</ul>
        {report.errors.length > 30 && <p className="muted">Mostrando os primeiros 30 avisos.</p>}
      </details>}
    </div>}
  </>;
}
