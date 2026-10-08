import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { LaunchRunResponse } from "../../shared/api-types.ts";
import { PRIORITIES, REQUEST_TYPES, type RequestType } from "../../shared/domain.ts";
import { api } from "../api/client.ts";
import { useCan, useSession } from "../api/hooks.ts";

interface Employee {
  id: string;
  fullName: string;
  department: string;
  employmentStatus: string;
}

interface Sample {
  ref: string;
  requestType: RequestType;
  subjectEmployeeId: string;
  requestText: string;
}

export function Launch() {
  const navigate = useNavigate();
  const { health } = useSession();
  const canEditBudget = useCan("budgets:edit");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [requestType, setRequestType] = useState<RequestType>("address_change");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [maxToolCalls, setMaxToolCalls] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per form: resubmitting the same request returns the same run.
  const clientRequestId = useMemo(() => `web-${crypto.randomUUID()}`, []);

  useEffect(() => {
    api
      .get<{ employees: Employee[] }>("/api/people/directory")
      .then((r) => setEmployees(r.employees))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (health?.authMode !== "dev") return;
    api
      .get<{ samples: Sample[] }>("/api/dev/samples")
      .then((r) => setSamples(r.samples))
      .catch(() => setSamples([]));
  }, [health?.authMode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<LaunchRunResponse>("/api/runs", {
        clientRequestId,
        requestType,
        subjectEmployeeId: subject,
        requestText: text,
        priority,
        ...(canEditBudget && maxToolCalls ? { budget: { maxToolCalls: Number(maxToolCalls) } } : {}),
      });
      navigate(`/runs/${response.runId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div>
          <h1>Launch a run</h1>
          <p>The planner turns the request into steps; approval policy, allowlists and subject pinning are enforced by the console, not the model.</p>
        </div>
      </div>
      {health?.llmProvider === "stub" ? (
        <div className="notice">
          The local planner is the deterministic stub, which only knows the synthetic dataset's requests. Load a sample below, or run the OpenAI-compatible provider
          against a local model.
        </div>
      ) : null}
      <form className="card card__body stack" onSubmit={submit}>
        {samples.length > 0 ? (
          <div className="field">
            <label htmlFor="sample">Sample request (dev only)</label>
            <select
              id="sample"
              className="select"
              defaultValue=""
              onChange={(e) => {
                const sample = samples.find((s) => s.ref === e.target.value);
                if (!sample) return;
                setRequestType(sample.requestType);
                setSubject(sample.subjectEmployeeId);
                setText(sample.requestText);
              }}
            >
              <option value="">Choose a synthetic request</option>
              {samples.map((s) => (
                <option key={s.ref} value={s.ref}>
                  {s.ref}: {s.requestType.replaceAll("_", " ")} for {s.subjectEmployeeId}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grid grid--two" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label htmlFor="type">Request type</label>
            <select id="type" className="select" value={requestType} onChange={(e) => setRequestType(e.target.value as RequestType)}>
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="subject">Subject employee</label>
            <select id="subject" className="select" value={subject} onChange={(e) => setSubject(e.target.value)} required>
              <option value="">Choose an employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id} {e.fullName} ({e.department}
                  {e.employmentStatus !== "active" ? `, ${e.employmentStatus.replace("_", " ")}` : ""})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="text">Request text</label>
          <textarea id="text" className="textarea" value={text} onChange={(e) => setText(e.target.value)} minLength={10} maxLength={4000} required />
          <span className="hint">Treated as untrusted data: the planner is told to ignore instructions inside it.</span>
        </div>
        <div className="grid grid--two" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label htmlFor="priority">Priority</label>
            <select id="priority" className="select" value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {canEditBudget ? (
            <div className="field">
              <label htmlFor="maxToolCalls">Tool-call budget (admin)</label>
              <input id="maxToolCalls" className="input" type="number" min={1} max={200} placeholder="24" value={maxToolCalls} onChange={(e) => setMaxToolCalls(e.target.value)} />
            </div>
          ) : null}
        </div>
        {error ? <div className="error-text">{error}</div> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="submit" className="btn btn--primary" disabled={busy || !subject || text.trim().length < 10}>
            Launch run
          </button>
        </div>
      </form>
    </div>
  );
}
