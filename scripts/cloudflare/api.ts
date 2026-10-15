// Minimal Cloudflare REST client for what wrangler does not cover: Zero Trust
// Access (applications, reusable policies, service tokens), AI Gateway and the
// GraphQL Analytics API. It authenticates with the account API token in
// CF_API_TOKEN and never prints it or any secret it receives.
//
// Endpoints (developers.cloudflare.com/api): /accounts/{id}/access/apps,
// /access/policies, /access/service_tokens (permissions "Access: Apps and
// Policies Edit" and "Access: Service Tokens Edit"), /ai-gateway/gateways
// ("AI Gateway Edit"), and /graphql ("Account Analytics Read").

const API = "https://api.cloudflare.com/client/v4";

export class ApiError extends Error {
  readonly status: number;
  readonly codes: number[];
  constructor(message: string, status: number, codes: number[]) {
    super(message);
    this.status = status;
    this.codes = codes;
  }
}

interface Envelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; per_page: number; total_pages?: number; total_count?: number; count?: number };
}

export interface AccessPolicy {
  id: string;
  name: string;
  decision: string;
  include: Record<string, unknown>[];
}

export interface AccessApp {
  id: string;
  name: string;
  domain: string;
  aud: string;
  type: string;
  allowed_idps?: string[];
  auto_redirect_to_identity?: boolean;
  policies?: { id: string; precedence?: number; name?: string }[];
}

export interface ServiceToken {
  id: string;
  name: string;
  client_id: string;
  client_secret?: string;
  expires_at?: string;
}

export class CloudflareApi {
  private readonly accountId: string;
  private readonly token: string;
  constructor(accountId: string, token: string) {
    this.accountId = accountId;
    this.token = token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json().catch(() => ({ success: false, errors: [{ code: response.status, message: response.statusText }] }))) as Envelope<T>;
    if (!response.ok || !envelope.success) {
      const errors = envelope.errors ?? [];
      throw new ApiError(`${method} ${path}: HTTP ${response.status} ${errors.map((e) => `${e.code} ${e.message}`).join("; ")}`, response.status, errors.map((e) => e.code));
    }
    return envelope;
  }

  private async list<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page < 100; page++) {
      const envelope = await this.call<T[]>("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=100`);
      items.push(...(envelope.result ?? []));
      const totalPages = envelope.result_info?.total_pages;
      if (!totalPages || page >= totalPages || (envelope.result ?? []).length === 0) break;
    }
    return items;
  }

  private account(path: string): string {
    return `/accounts/${this.accountId}${path}`;
  }

  // --- Access ---------------------------------------------------------------

  listApps(): Promise<AccessApp[]> {
    return this.list<AccessApp>(this.account("/access/apps"));
  }

  async createApp(body: Record<string, unknown>): Promise<AccessApp> {
    return (await this.call<AccessApp>("POST", this.account("/access/apps"), body)).result;
  }

  async updateApp(id: string, body: Record<string, unknown>): Promise<AccessApp> {
    return (await this.call<AccessApp>("PUT", this.account(`/access/apps/${id}`), body)).result;
  }

  listPolicies(): Promise<AccessPolicy[]> {
    return this.list<AccessPolicy>(this.account("/access/policies"));
  }

  async createPolicy(body: Record<string, unknown>): Promise<AccessPolicy> {
    return (await this.call<AccessPolicy>("POST", this.account("/access/policies"), body)).result;
  }

  async updatePolicy(id: string, body: Record<string, unknown>): Promise<AccessPolicy> {
    return (await this.call<AccessPolicy>("PUT", this.account(`/access/policies/${id}`), body)).result;
  }

  listServiceTokens(): Promise<ServiceToken[]> {
    return this.list<ServiceToken>(this.account("/access/service_tokens"));
  }

  /** The response carries client_secret; this is the only time it is readable. */
  async createServiceToken(name: string): Promise<ServiceToken> {
    return (await this.call<ServiceToken>("POST", this.account("/access/service_tokens"), { name, duration: "8760h" })).result;
  }

  /** A new client_secret for an existing token (the client_id stays). */
  async rotateServiceToken(id: string): Promise<ServiceToken> {
    return (await this.call<ServiceToken>("POST", this.account(`/access/service_tokens/${id}/rotate`), {})).result;
  }

  // --- AI Gateway -----------------------------------------------------------

  async getGateway(id: string): Promise<Record<string, unknown> | null> {
    try {
      return (await this.call<Record<string, unknown>>("GET", this.account(`/ai-gateway/gateways/${id}`))).result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async createGateway(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.call<Record<string, unknown>>("POST", this.account("/ai-gateway/gateways"), body)).result;
  }

  // --- GraphQL Analytics ------------------------------------------------------

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] | null };
    if (!response.ok || (body.errors && body.errors.length > 0)) {
      throw new Error(`graphql: HTTP ${response.status} ${(body.errors ?? []).map((e) => e.message).join("; ")}`);
    }
    return body.data as T;
  }
}

export function apiFromEnv(accountId: string, variable: string): CloudflareApi | null {
  const token = process.env[variable];
  return token && token.trim() ? new CloudflareApi(accountId, token.trim()) : null;
}
