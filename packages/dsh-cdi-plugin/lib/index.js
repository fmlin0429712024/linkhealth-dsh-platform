/**
 * dsh-cdi-plugin — Step 1: pure host plugin, AS-IS DSH GUI.
 *
 * Wraps the synthetic CDI auditing domain for DeepSeek Harness:
 *   - `cdi_query_rule` : evaluate one deterministic SOP rule against one
 *     record via tools/query_deterministic_rule.py against the bundled
 *     SQLite SOP stores (the LLM never judges the threshold itself).
 *   - `cdi_list_rules`: list every deterministic rule in a bundled SOP store.
 *   - optional bundled-skills provider (`bundledSkills: true`): serves the
 *     packaged skills/ tree for deployments without a repo `.agents/skills`.
 *
 * Everything here is synthetic/fictional — never point this at real patient
 * or client data, and never treat any output as a clinical, coding, billing,
 * or compliance decision.
 *
 * @module dsh-cdi-plugin
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";

export const name = "cdi-plugin";
export const inject = ["tools", "skills"];

export const Config = Schema.object({
  /** Python executable used to run tools/query_deterministic_rule.py. */
  python: Schema.string().default("python3"),
  /**
   * Serve the packaged skills/ tree through a provider named `cdi-bundled`.
   * Defaults to false: inside a repo whose `.agents/skills` exists, the
   * built-in filesystem provider already discovers the same skills, and a
   * second provider would only duplicate the catalog. Enable it for
   * deployments that carry no repo skill tree.
   */
  bundledSkills: Schema.boolean().default(false),
  /**
   * Override where the SQLite stores / gold sets are read from.
   * Empty (default) = the plugin's own bundled data/ directory, which is the
   * portable story. Point it at the repo root only while developing in place.
   */
  dataRoot: Schema.string().default(""),
});

/** Plugin package root: <pkg>/lib/index.js -> <pkg>. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = join(ROOT, "tools", "query_deterministic_rule.py");

/**
 * Run the SQLite-backed rule tool. One (rule, record) question per call;
 * stdout JSON is parsed and returned verbatim (shape is the tool's own, so
 * the guardrail "report the SQLite-backed result verbatim" holds).
 */
function runRuleTool(python, args, stdinData, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(python, [SCRIPT_PATH, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(new Error(`cdi tool failed to start (${err.message}); is "${python}" installed?`));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `cdi tool exited with code ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        rejectPromise(new Error(`cdi tool returned non-JSON output: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

/** The four judgment fields of a finding card (see rules/synthetic-audit-rules.md). */
const FINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rule_id: { type: "string", required: true },
    method: { type: "string", required: true },
    triggered: { type: "boolean", required: true },
    trigger_description: { type: "string", required: true },
    status: { type: "string", required: true },
    draft_question: { oneOf: [{ type: "string" }, { type: "null" }] },
    prohibited_inference: { type: "string", required: true },
  },
};

export function apply(ctx, config = {}) {
  const python = config.python ?? "python3";
  const dataRoot = config.dataRoot ? resolve(config.dataRoot) : join(ROOT, "data");
  const sharedDb = join(dataRoot, "audit_rules.db");
  const multiDomainDb = join(dataRoot, "audit_rules-multi-domain.db");

  ctx.tools.register(defineTool({
    name: "cdi_query_rule",
    description:
      "Evaluate one deterministic SOP rule (e.g. SYN-ICHD-01, SYN-ICHD-09, SYN-ICHD-06) against one record from the synthetic gold set, using the SQLite SOP store. The result is authoritative — never judge the threshold yourself. Use the 'multi-domain' store for the patient-domain rule SYN-ICHD-06 (single patient-level check, not looped per treatment).",
    parameters: {
      ruleId: {
        type: "string",
        required: true,
        description: "Rule id, e.g. SYN-ICHD-01. See cdi_list_rules for the catalog.",
      },
      record: {
        type: "object",
        additionalProperties: true,
        required: true,
        description:
          "The record to evaluate, as JSON: a clinical_treatments[] entry for treatment-domain rules, or the whole patient object for SYN-ICHD-06.",
      },
      store: {
        type: "string",
        enum: ["shared", "multi-domain"],
        description: "Which SOP store to query. Default 'shared' (audit_rules.db); 'multi-domain' (audit_rules-multi-domain.db) for SYN-ICHD-06.",
      },
    },
    output: {
      schema: FINDING_SCHEMA,
      render: (_args, value) => [{
        type: "text",
        text: [
          `Rule ${value.rule_id}: ${value.triggered ? "TRIGGERED" : "not triggered"}`,
          `  status: ${value.status}`,
          value.draft_question ? `  draft question: ${value.draft_question}` : null,
          `  prohibited inference: ${value.prohibited_inference}`,
        ].filter(Boolean).join("\n"),
      }],
    },
    timeoutMs: 30_000,
    async execute(args, exec) {
      const dbArgs = args.store === "multi-domain" ? ["--db", multiDomainDb] : [];
      return runRuleTool(python, [args.ruleId, "-", ...dbArgs], JSON.stringify(args.record), exec.signal);
    },
    presentCall(args) {
      return {
        card: "generic",
        title: `Query rule ${args.ruleId}`,
        kind: "read",
        rawInput: args.ruleId,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "cdi_list_rules",
    description: "List every deterministic rule in the bundled SQLite SOP store(s) with its trigger description. Use before a full deterministic pass to enumerate the catalog.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          shared: {
            type: "array",
            required: true,
            items: { type: "object", additionalProperties: true },
          },
          multi_domain: {
            type: "array",
            required: true,
            items: { type: "object", additionalProperties: true },
          },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: [
          "shared store:",
          ...value.shared.map((r) => `  ${r.rule_id} — ${r.description}`),
          "multi-domain store:",
          ...value.multi_domain.map((r) => `  ${r.rule_id} — ${r.description}`),
        ].join("\n"),
      }],
    },
    timeoutMs: 30_000,
    async execute(_args, exec) {
      const [shared, multiDomain] = await Promise.all([
        runRuleTool(python, ["--list"], "", exec.signal),
        runRuleTool(python, ["--list", "--db", multiDomainDb], "", exec.signal),
      ]);
      return { shared, multi_domain: multiDomain };
    },
    presentCall() {
      return { card: "generic", title: "List deterministic rules", kind: "read", rawInput: "catalog" };
    },
  }));

  if (config.bundledSkills) {
    ctx.skills.registerProvider(() => createBundledSkillProvider(join(ROOT, "skills")));
  }
}

/**
 * Minimal provider over the packaged skills/ tree: <skillsDir>/<name>/SKILL.md.
 * This is a deliberately small fallback (name/description from a single-line
 * `key: value` frontmatter); the repo's full provider is the built-in
 * filesystem one — this only exists so the plugin is self-contained when
 * deployed without a repo skill tree.
 */
function createBundledSkillProvider(skillsDir) {
  function scan() {
    const candidates = [];
    for (const entry of readdirSync(skillsDir)) {
      const skillDir = join(skillsDir, entry);
      const skillFile = join(skillDir, "SKILL.md");
      if (!statSync(skillDir).isDirectory() || !exists(skillFile)) continue;
      const body = readFileSync(skillFile, "utf8");
      const fm = parseFrontmatter(body);
      if (!fm.name || !fm.description) continue;
      candidates.push({
        name: fm.name,
        description: fm.description,
        invocation: { modelInvocable: true, userInvocable: true },
      });
    }
    return { candidates, complete: true };
  }
  return {
    name: "cdi-bundled",
    list() {
      return scan().candidates;
    },
    get(candidate) {
      const body = readFileSync(join(skillsDir, candidate.name, "SKILL.md"), "utf8");
      const fm = parseFrontmatter(body);
      return {
        name: candidate.name,
        description: candidate.description,
        provider: "cdi-bundled",
        invocation: { modelInvocable: true, userInvocable: true },
        content: stripFrontmatter(body),
      };
    },
  };
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Parse single-line `key: value` frontmatter between leading `---` fences. */
function parseFrontmatter(body) {
  const out = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function stripFrontmatter(body) {
  return body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
