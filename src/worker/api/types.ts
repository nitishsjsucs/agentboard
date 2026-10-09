import type { Permission, Role } from "../../shared/domain.ts";
import type { Principal } from "../auth/principal.ts";
import type { Config } from "../config.ts";

export interface Identity {
  principal: Principal;
  role: Role | null;
  permissions: Permission[];
  /** Expiry of the verified identity token (epoch ms), or null when it carries no `exp`. */
  expiresAt: number | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    config: Config;
    requestId: string;
    identity: Identity;
  };
}
