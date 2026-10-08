// Fictional catalog for the synthetic dataset. Every name, email and address
// here is invented; emails use @agentboard.test and @example.test.

import type { RequestType } from "../domain.ts";

export const DEPARTMENTS = ["Engineering", "Sales", "Finance", "People", "Support", "Legal"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const MANAGER_TITLES: Record<Department, string> = {
  Engineering: "Head of Engineering",
  Sales: "Head of Sales",
  Finance: "Head of Finance",
  People: "Head of People",
  Support: "Head of Support",
  Legal: "General Counsel",
};

export const STAFF_TITLES: Record<Department, readonly string[]> = {
  Engineering: ["Software Engineer", "Senior Software Engineer", "Site Reliability Engineer", "Engineering Manager"],
  Sales: ["Account Executive", "Sales Development Rep", "Solutions Consultant", "Sales Operations Analyst"],
  Finance: ["Financial Analyst", "Payroll Specialist", "Accountant", "Controller"],
  People: ["People Partner", "Recruiter", "People Operations Specialist", "Benefits Analyst"],
  Support: ["Support Engineer", "Customer Success Manager", "Support Specialist", "Technical Writer"],
  Legal: ["Counsel", "Paralegal", "Compliance Analyst", "Contracts Manager"],
};

export const FIRST_NAMES = [
  "Avery", "Bryn", "Cato", "Dalia", "Emeric", "Fenna", "Gideon", "Halia", "Ilse", "Joaquin",
  "Kesia", "Lorcan", "Mireille", "Niall", "Odette", "Pascale", "Quillon", "Rosalind", "Soren", "Tamsin",
  "Ulric", "Verity", "Wilder", "Xanthe", "Yorick", "Zelie", "Anouk", "Bastian", "Coralie", "Dorian",
  "Elodie", "Florian", "Greer", "Hollis", "Imogen", "Jasper",
] as const;

export const LAST_NAMES = [
  "Ashdown", "Brightwater", "Calloway", "Dunmore", "Everhart", "Fairbanks", "Galloway", "Hollister", "Ingleby", "Jessamy",
  "Kingsley", "Lockridge", "Merriweather", "Northcott", "Oakhurst", "Pemberton", "Quenby", "Ravenscroft", "Stanbury", "Thistlewood",
  "Underhill", "Vantongeren", "Whitlock", "Yardley", "Zellweger", "Ambrose", "Blackwood", "Cranford", "Delacroix", "Elsworth",
] as const;

export interface CityInfo {
  city: string;
  region: string;
  postalPrefix: string;
}

/** Office locations; each employee's home city follows the location (Remote picks one of REMOTE_CITIES). */
export const LOCATION_COUNTS = { "San Jose": 18, Austin: 15, "New York": 15, Remote: 12 } as const;
export type Location = keyof typeof LOCATION_COUNTS;

export const OFFICE_CITIES: Record<Exclude<Location, "Remote">, CityInfo> = {
  "San Jose": { city: "San Jose", region: "CA", postalPrefix: "951" },
  Austin: { city: "Austin", region: "TX", postalPrefix: "787" },
  "New York": { city: "New York", region: "NY", postalPrefix: "100" },
};

export const REMOTE_CITIES: readonly CityInfo[] = [
  { city: "Boise", region: "ID", postalPrefix: "837" },
  { city: "Madison", region: "WI", postalPrefix: "537" },
  { city: "Asheville", region: "NC", postalPrefix: "288" },
  { city: "Spokane", region: "WA", postalPrefix: "992" },
  { city: "Tucson", region: "AZ", postalPrefix: "857" },
];

export const STREET_NAMES = [
  "Larkspur Lane", "Quarry Road", "Juniper Court", "Harbor View Drive", "Millbrook Way", "Cedar Hollow Road",
  "Sparrow Street", "Kestrel Avenue", "Orchard Terrace", "Bramble Path", "Willow Bend", "Foxglove Drive",
  "Granite Row", "Lantern Square", "Meadowlark Circle", "Copperfield Street",
] as const;

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  address_change: "Address change",
  manager_change: "Manager change",
  onboarding_access: "Onboarding access",
  privileged_access: "Privileged access",
  offboarding: "Offboarding",
  access_revocation: "Access revocation",
};

/** Words appended to an employee's name for the known-item search queries. */
export const REQUEST_TYPE_QUERY_WORDS: Record<RequestType, string> = {
  address_change: "address change",
  manager_change: "manager change",
  onboarding_access: "onboarding access",
  privileged_access: "privileged access",
  offboarding: "offboarding",
  access_revocation: "access revocation",
};

/**
 * Request text templates: 5 per request type (30 in total). Placeholders:
 * {name} {id} {channel} and type-specific fields {address} {managerName}
 * {managerId} {system} {role} {effectiveDate}.
 */
export const REQUEST_TEMPLATES: Record<RequestType, readonly string[]> = {
  address_change: [
    "Please update the home address for {name} ({id}) to {address}. Let them know by {channel} once it is done.",
    "{name} ({id}) moved. New address: {address}. Update HRIS and confirm by {channel}.",
    "Address change request for employee {id} ({name}): new home address is {address}. Notify via {channel}.",
    "Hi team, {name} (employee {id}) has a new mailing address, {address}. Please record it and confirm by {channel}.",
    "Update {id}'s address on file to {address}. The employee is {name}; confirm by {channel}.",
  ],
  manager_change: [
    "{name} ({id}) now reports to {managerName} ({managerId}). Please update the reporting line and notify them by {channel}.",
    "Reorg: move {id} ({name}) under manager {managerId} ({managerName}). Notify them by {channel} when done.",
    "Please change the manager of {name} ({id}) to {managerName}, employee {managerId}. Notify via {channel}.",
    "Manager change for {id}: new manager is {managerId} ({managerName}). Employee: {name}. Confirm by {channel}.",
    "{name} (employee {id}) is transferring to {managerName}'s team ({managerId}). Update HRIS and message them by {channel}.",
  ],
  onboarding_access: [
    "{name} ({id}) starts soon. Please open a laptop provisioning ticket, grant {system}:{role}, and send the onboarding notice by {channel}.",
    "New hire {id} ({name}) needs a laptop and the {system} {role} role. Notify them via {channel} when ready.",
    "Onboarding for {name}, employee {id}: provision a laptop, add baseline access {system}:{role}, and confirm by {channel}.",
    "Please get {id} ({name}) ready for day one: laptop ticket, {system}:{role} access, and a welcome message by {channel}.",
    "Set up {name} ({id}): laptop provisioning plus {system}:{role}. Send the ready notice by {channel}.",
  ],
  privileged_access: [
    "{name} ({id}) needs the privileged role {system}:{role} for their new duties. Notify them by {channel} once granted.",
    "Request elevated access {system}:{role} for employee {id} ({name}). Confirm via {channel}.",
    "Please grant {system}:{role} to {name} ({id}). This is privileged; confirm by {channel} after approval.",
    "Privileged access request: {id} ({name}) requires {system}:{role}. Notify via {channel}.",
    "Grant {name}, employee {id}, the {system}:{role} role and let them know by {channel}.",
  ],
  offboarding: [
    "{name} ({id}) is leaving. Terminate employment effective {effectiveDate}, revoke all access, open a laptop return ticket, and notify by {channel}.",
    "Offboard employee {id} ({name}) effective {effectiveDate}: status terminated, remove every role, laptop return, and a notice by {channel}.",
    "Please process the departure of {name} ({id}) on {effectiveDate}. Revoke access, collect the laptop, confirm via {channel}.",
    "Offboarding request for {id}, {name}. Last day {effectiveDate}. Full access removal and laptop return; notify via {channel}.",
    "{name} (employee {id}) resigned; effective date {effectiveDate}. Terminate, revoke all roles, ticket the laptop return, and message them by {channel}.",
  ],
  access_revocation: [
    "Please revoke {system}:{role} from {name} ({id}) and notify them by {channel}.",
    "{name} ({id}) no longer needs {system}:{role}. Remove it and notify them by {channel}.",
    "Access review: remove the {system} {role} role from employee {id} ({name}). Confirm via {channel}.",
    "Revoke {id}'s {system}:{role} access. Employee: {name}. Notify via {channel}.",
    "Please take away {system}:{role} for {name}, employee {id}, and confirm by {channel}.",
  ],
};

export const NOTIFY_TEMPLATE_FOR: Record<RequestType, string> = {
  address_change: "address_updated",
  manager_change: "manager_updated",
  onboarding_access: "onboarding_ready",
  privileged_access: "privileged_access_granted",
  offboarding: "offboarding_complete",
  access_revocation: "access_revoked",
};

export interface PrincipalSeed {
  principal: string;
  role: "viewer" | "operator" | "approver" | "admin";
  displayName: string;
}

/** The 9 console principals (SPEC section 12.1). */
export const PRINCIPALS: readonly PrincipalSeed[] = [
  { principal: "viewer.ana@agentboard.test", role: "viewer", displayName: "Ana Viewer" },
  { principal: "viewer.ben@agentboard.test", role: "viewer", displayName: "Ben Viewer" },
  { principal: "ops.lead@agentboard.test", role: "operator", displayName: "Ops Lead" },
  { principal: "ops.kim@agentboard.test", role: "operator", displayName: "Kim Operator" },
  { principal: "ops.raj@agentboard.test", role: "operator", displayName: "Raj Operator" },
  { principal: "approver.lee@agentboard.test", role: "approver", displayName: "Lee Approver" },
  { principal: "approver.mia@agentboard.test", role: "approver", displayName: "Mia Approver" },
  { principal: "admin@agentboard.test", role: "admin", displayName: "Admin" },
  { principal: "svc:agentboard-eval", role: "operator", displayName: "Eval service token" },
];

export const OPERATOR_LAUNCHERS = ["ops.lead@agentboard.test", "ops.kim@agentboard.test", "ops.raj@agentboard.test"] as const;
export const APPROVERS = ["approver.lee@agentboard.test", "approver.mia@agentboard.test"] as const;
export const ADMIN_PRINCIPAL = "admin@agentboard.test";
