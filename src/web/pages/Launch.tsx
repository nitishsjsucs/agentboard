import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { AgentRolesResponse, LaunchRunResponse } from "../../shared/api-types.ts";
import { PRIORITIES, REQUEST_TYPES, type RequestType } from "../../shared/domain.ts";
import { api, ApiRequestError } from "../api/client.ts";
import { useCan, useSession } from "../api/hooks.ts";
import { usePageTitle } from "../api/usePageTitle.ts";
import { ErrorNotice } from "../components/ErrorNotice.tsx";

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

interface LaunchBody {
  clientRequestId: string;
  requestType: RequestType;
  subjectEmployeeId: string;
  requestText: string;
  priority: (typeof PRIORITIES)[number];
  budget?: { maxToolCalls: number };
}

const DEFAULT_TYPE: RequestType = "address_change";
const MIN_TEXT = 10;

/** One idempotency key per request: resubmitting the same request returns the same run. */
function newClientRequestId(): string {
  return `web-${crypto.randomUUID()}`;
}

/**
 * A failure after which the request may or may not have reached the server. A redirect is not one: the
 * API never redirects, so the request stopped in front of the Worker (behind Access, at its login page).
 */
function mayHaveLanded(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.code === "network" || error.code === "unavailable");
}

function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409 && error.reason === "idempotency_conflict";
}

export function Launch() {
  usePageTitle("Launch a run");
  const canLaunch = useCan("runs:launch");
  const { me } = useSession();
  if (!canLaunch) {
    // No form (and no directory, samples or agents request) for a role that cannot launch.
    return (
      <div className="stack" style={{ maxWidth: 760 }}>
        <div className="page-header">
          <div>
            <h1 tabIndex={-1}>Launch a run</h1>
          </div>
        </div>
        <div className="notice" data-testid="cannot-launch">
          Your role{me?.role ? ` (${me.role})` : ""} cannot launch runs. You can follow existing runs on <Link to="/runs">Runs</Link> and decisions on{" "}
          <Link to="/approvals">Approvals</Link>.
        </div>
      </div>
    );
  }
  return <LaunchForm />;
}

function LaunchForm() {
  const navigate = useNavigate();
  const { health } = useSession();
  const canEditBudget = useCan("budgets:edit");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [directoryError, setDirectoryError] = useState<unknown>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleRef, setSampleRef] = useState("");
  const [disabledRoles, setDisabledRoles] = useState<AgentRolesResponse["roles"]>([]);
  const [requestType, setRequestType] = useState<RequestType>(DEFAULT_TYPE);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [maxToolCalls, setMaxToolCalls] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);
  // The exact body of a launch whose answer was lost; "Try again" resends it unchanged.
  const [unanswered, setUnanswered] = useState<LaunchBody | null>(null);

  const loadDirectory = () => {
    setDirectoryError(null);
    api
      .get<{ employees: Employee[] }>("/api/people/directory")
      .then((r) => setEmployees(r.employees))
      .catch((e: unknown) => setDirectoryError(e));
  };
  useEffect(loadDirectory, []);
  useEffect(() => {
    if (health?.authMode !== "dev") return;
    api
      .get<{ samples: Sample[] }>("/api/dev/samples")
      .then((r) => setSamples(r.samples))
      .catch(() => setSamples([]));
  }, [health?.authMode]);
  useEffect(() => {
    api
      .get<AgentRolesResponse>("/api/agents")
      .then((r) => setDisabledRoles(r.roles.filter((role) => role.disabled)))
      .catch(() => setDisabledRoles([]));
  }, []);

  const locked = unanswered !== null;
  const textLength = text.trim().length;
  const hints = [...(subject ? [] : ["Choose a subject employee."]), ...(textLength >= MIN_TEXT ? [] : [`Request text needs at least ${MIN_TEXT} characters (${textLength} of ${MIN_TEXT}).`])];
  const matchesSample = samples.some((s) => s.requestType === requestType && s.subjectEmployeeId === subject && s.requestText.trim() === text.trim());
  const stubWarning = health?.llmProvider === "stub" && textLength > 0 && !matchesSample;

  const send = async (body: LaunchBody) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<LaunchRunResponse>("/api/runs", body);
      navigate(`/runs/${response.runId}`);
    } catch (e) {
      setError(e);
      setUnanswered(mayHaveLanded(e) ? body : null);
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked || hints.length > 0) return;
    await send({
      clientRequestId,
      requestType,
      subjectEmployeeId: subject,
      requestText: text,
      priority,
      ...(canEditBudget && maxToolCalls ? { budget: { maxToolCalls: Number(maxToolCalls) } } : {}),
    });
  };

  /** Unlocks the fields with a fresh idempotency key: what is sent next is a new request. */
  const startNew = () => {
    setClientRequestId(newClientRequestId());
    setUnanswered(null);
    setError(null);
  };

  const chooseSample = (ref: string) => {
    setSampleRef(ref);
    const sample = samples.find((s) => s.ref === ref);
    if (!sample) {
      // Back to the placeholder: clear what the previous sample filled in.
      setRequestType(DEFAULT_TYPE);
      setSubject("");
      setText("");
      return;
    }
    setRequestType(sample.requestType);
    setSubject(sample.subjectEmployeeId);
    setText(sample.requestText);
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div>
          <h1 tabIndex={-1}>Launch a run</h1>
          <p>The planner turns the request into steps; approval policy, allowlists and subject pinning are enforced by the console, not the model.</p>
        </div>
      </div>
      {health?.llmProvider === "stub" ? (
        <div className="notice">
          The local planner is the deterministic stub, which only knows the synthetic dataset's requests. Load a sample below, or run the OpenAI-compatible provider
          against a local model.
        </div>
      ) : null}
      {disabledRoles.map((role) => (
        <div key={role.role} className="notice notice--warning" data-testid="disabled-role">
          The {role.role} role is disabled ({role.reason ? `${role.reason}, ` : ""}by {role.updatedBy}). New runs will wait until an admin enables it.
        </div>
      ))}
      <form className="card card__body stack" onSubmit={submit}>
        {samples.length > 0 ? (
          <div className="field">
            <label htmlFor="sample">Sample request (dev only)</label>
            <select id="sample" className="select" value={sampleRef} disabled={locked} onChange={(e) => chooseSample(e.target.value)}>
              <option value="">Choose a synthetic request</option>
              {samples.map((s) => (
                <option key={s.ref} value={s.ref}>
                  {s.ref}: {s.requestType.replaceAll("_", " ")} for {s.subjectEmployeeId}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="form-two">
          <div className="field">
            <label htmlFor="type">Request type</label>
            <select id="type" className="select" value={requestType} disabled={locked} onChange={(e) => setRequestType(e.target.value as RequestType)}>
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="subject">Subject employee</label>
            <select id="subject" className="select" value={subject} disabled={locked} onChange={(e) => setSubject(e.target.value)} required>
              <option value="">Choose an employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id} {e.fullName} ({e.department}
                  {e.employmentStatus !== "active" ? `, ${e.employmentStatus.replace("_", " ")}` : ""})
                </option>
              ))}
            </select>
            {directoryError ? <ErrorNotice error={directoryError} title="The employee list did not load." action="launch runs" onRetry={loadDirectory} /> : null}
          </div>
        </div>
        <div className="field">
          <label htmlFor="text">Request text</label>
          <textarea id="text" className="textarea" value={text} readOnly={locked} onChange={(e) => setText(e.target.value)} minLength={MIN_TEXT} maxLength={4000} required />
          <span className="hint">Treated as untrusted data: the planner is told to ignore instructions inside it.</span>
        </div>
        {stubWarning ? (
          <div className="notice notice--warning" data-testid="stub-warning">
            The local stub planner only plans the sample requests exactly. This request will probably fail planning and need attention.
          </div>
        ) : null}
        <div className="form-two">
          <div className="field">
            <label htmlFor="priority">Priority</label>
            <select id="priority" className="select" value={priority} disabled={locked} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}>
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
              <input
                id="maxToolCalls"
                className="input"
                type="number"
                min={1}
                max={200}
                placeholder="24"
                value={maxToolCalls}
                disabled={locked}
                onChange={(e) => setMaxToolCalls(e.target.value)}
              />
            </div>
          ) : null}
        </div>
        {unanswered ? (
          <div className="notice notice--warning" role="alert" data-testid="launch-unanswered">
            <div>The launch may not have reached AgentBoard. Try again sends the same request with the same key, so it cannot start a second run.</div>
            <div className="row" style={{ marginTop: "var(--space-2)" }}>
              <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => void send(unanswered)}>
                Try again
              </button>
              <button type="button" className="btn btn--small" disabled={busy} onClick={startNew}>
                Edit request
              </button>
            </div>
          </div>
        ) : error && isIdempotencyConflict(error) ? (
          <div className="notice notice--danger" role="alert" data-testid="launch-conflict">
            <div>
              This form already launched a different request. Check <Link to="/runs">Runs</Link> for it, or start a new request.
            </div>
            <div className="row" style={{ marginTop: "var(--space-2)" }}>
              <button type="button" className="btn btn--small" onClick={startNew}>
                Start a new request
              </button>
            </div>
          </div>
        ) : error ? (
          <ErrorNotice error={error} action="launch runs" />
        ) : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {hints.length > 0 ? (
            <div id="launch-hint" className="hint small muted" data-testid="launch-hint">
              {hints.map((hint) => (
                <div key={hint}>{hint}</div>
              ))}
            </div>
          ) : null}
          {busy ? (
            <span role="status" className="small muted">
              Launching...
            </span>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={busy || locked || hints.length > 0} aria-describedby={hints.length > 0 ? "launch-hint" : undefined}>
            Launch run
          </button>
        </div>
      </form>
    </div>
  );
}
