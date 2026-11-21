import type { AgyEnvelope, AgyUsage, DeniedAction } from "./envelope.js";
import { QUOTA_RE } from "./quota.js";

/**
 * Why a run did not produce a usable answer. Quota can cool a candidate down
 * for the next independent request. No failure after dispatch proves that
 * replaying the entire agent turn is safe.
 */
export type FailureKind =
  | "quota"
  | "invalid_model"
  | "unauthenticated"
  | "network"
  | "empty"
  | "agy_error"
  | "not_installed";

export interface FailurePolicy {
  /** Quota can exclude this model on a later independent request. */
  failover: boolean;
  /** Legacy policy field; whole-turn replay is disabled for every failure. */
  retryOnce: boolean;
}

const POLICY: Record<FailureKind, FailurePolicy> = {
  quota: { failover: true, retryOnce: false },
  invalid_model: { failover: false, retryOnce: false },
  unauthenticated: { failover: false, retryOnce: false },
  network: { failover: false, retryOnce: false },
  empty: { failover: false, retryOnce: false },
  agy_error: { failover: false, retryOnce: false },
  not_installed: { failover: false, retryOnce: false },
};

export function policyFor(kind: FailureKind): FailurePolicy {
  return POLICY[kind];
}

/**
 * The first matching pattern wins, so order is policy. Quota comes before auth
 * and network: "PERMISSION_DENIED: RESOURCE_EXHAUSTED" is an exhausted model
 * that should fail over, and a 429 that also mentions a reset connection must
 * not retry the exhausted one. Status codes count only beside a status word, so
 * a source location like "foo.ts:401:3" is not an auth failure. A bare EOF is a
 * network blip only where Go puts one, at the end of a read ("…:443: EOF"); a
 * parser's "unexpected EOF" is not worth repeating.
 */
const PATTERNS: [FailureKind, RegExp][] = [
  ["invalid_model", /invalid model selection|is not recognized as a known model/i],
  ["quota", QUOTA_RE],
  [
    "unauthenticated",
    /unauthenticated|not logged in|authentication failed|please (re-?)?login|invalid credentials|PERMISSION_DENIED|UNAUTHENTICATED|\b(?:code|status|HTTP)[\s:=]*401\b|\b401 Unauthorized\b|\bauth\w*\s+(has\s+)?expired|\btoken\s+(has\s+)?expired|re-authenticate/i,
  ],
  [
    "network",
    /dial tcp|no such host|connection refused|connection reset|network is unreachable|i\/o timeout|TLS handshake|:\s*EOF\s*$|ENOTFOUND|ECONNRESET|ETIMEDOUT/im,
  ],
];

/** The kind implied by a message, or undefined when nothing matches. */
export function classifyMessage(text: string): FailureKind | undefined {
  for (const [kind, re] of PATTERNS) if (re.test(text)) return kind;
  return undefined;
}

export interface ClassifyInput {
  envelope: AgyEnvelope | null;
  exitCode: number | null;
  stderr: string;
}

/** Machine-readable terminal failure, available in agy >= 1.2.6. */
export interface AgyErrorDetails {
  status?: string;
  code?: number | string;
  retryable?: boolean;
  errorId?: string;
}

export function parseAgyError(stderr: string): AgyErrorDetails | undefined {
  for (const line of stderr.split("\n").reverse()) {
    const diagnostic = line.trimStart();
    if (!diagnostic.startsWith("AGY_ERROR:")) continue;
    try {
      const value: unknown = JSON.parse(diagnostic.slice("AGY_ERROR:".length).trim());
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const o = value as Record<string, unknown>;
      const id = o.error_id ?? o.errorId ?? o.id;
      return {
        ...(typeof o.status === "string" ? { status: o.status } : {}),
        ...(typeof o.code === "string" || typeof o.code === "number" ? { code: o.code } : {}),
        ...(typeof o.retryable === "boolean" ? { retryable: o.retryable } : {}),
        ...(typeof id === "string" ? { errorId: id } : {}),
      };
    } catch {
      // Older CLIs and malformed diagnostic lines retain text classification.
    }
  }
  return undefined;
}

function kindOfDetails(details: AgyErrorDetails | undefined): FailureKind | undefined {
  if (!details) return undefined;
  const code = Number(details.code);
  if (details.status === "RESOURCE_EXHAUSTED" || [8, 429].includes(code)) return "quota";
  if (
    details.status === "UNAUTHENTICATED" ||
    details.status === "PERMISSION_DENIED" ||
    [7, 16, 401, 403].includes(code)
  )
    return "unauthenticated";
  if (
    details.status === "UNAVAILABLE" ||
    details.status === "DEADLINE_EXCEEDED" ||
    [4, 14, 502, 503, 504].includes(code)
  )
    return "network";
  return undefined;
}

/**
 * The failure a finished run represents, or null when it produced a real answer.
 * A run with denied actions is *not* a failure — it answered, just with less
 * authority than it wanted; the caller is told about the denials separately.
 */
export function classifyRun(input: ClassifyInput): { kind: FailureKind; message: string } | null {
  const { envelope, exitCode, stderr } = input;
  const structuredKind = kindOfDetails(parseAgyError(stderr));

  if (envelope) {
    if (envelope.status !== "SUCCESS" || envelope.finishedReason) {
      const text =
        envelope.error ||
        (envelope.finishedReason
          ? `agy ended early (${envelope.finishedReason}).`
          : envelope.response) ||
        `agy status ${envelope.status}`;
      return { kind: structuredKind ?? classifyMessage(text) ?? "agy_error", message: text.trim() };
    }
    if (exitCode !== 0) {
      return {
        kind: structuredKind ?? classifyMessage(stderr) ?? "agy_error",
        message: stderr.trim() || `agy exited with code ${exitCode} after reporting a response.`,
      };
    }
    if (!envelope.response.trim()) {
      return {
        kind: "empty",
        message:
          "agy reported SUCCESS with an empty response — the turn produced no answer " +
          "(usually its print-timeout elapsed mid-run).",
      };
    }
    return null;
  }

  // No envelope: agy is older than --output-format json, or died before printing one.
  const text = stderr.trim();
  if (exitCode !== 0) {
    return {
      kind: structuredKind ?? classifyMessage(text) ?? "agy_error",
      message: text || `agy exited with code ${exitCode}.`,
    };
  }
  return null;
}

/**
 * The call itself was unusable: a path outside the roots, a prompt agy cannot
 * receive, a working directory that does not exist. Nothing was delegated, so
 * this is the caller's to fix, not a delegation failure to escalate.
 */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export class AgyFailure extends Error {
  /** Tokens the failed run still spent, when agy reported them. */
  usage?: AgyUsage;
  usageKnown?: boolean;
  /** Provider retryability is diagnostic; it never proves an agent turn is safe to replay. */
  details?: AgyErrorDetails;
  partialOutput?: string;
  conversationId?: string;
  finishedReason?: string;
  numTurns?: number;
  deniedActions?: DeniedAction[];
  structuredOutput?: unknown;

  constructor(
    readonly kind: FailureKind,
    message: string,
    /** The model that produced it, when one was pinned. */
    readonly model?: string,
  ) {
    super(message);
    this.name = "AgyFailure";
  }

  get policy(): FailurePolicy {
    return policyFor(this.kind);
  }
}

/** A generous raw protocol/log ceiling, separate from rendered answer length. */
export const MAX_RAW_OUTPUT_BYTES = 64 * 1024 * 1024;

/** A stopped turn may already have performed actions; this is never replay-safe. */
export class OutputLimitError extends AgyFailure {
  constructor(
    readonly source: string,
    readonly limitBytes: number,
    model?: string,
  ) {
    super(
      "agy_error",
      `agy ${source} exceeded the bridge's ${limitBytes}-byte raw output limit. ` +
        `The turn was stopped and its output is incomplete; actions may already have run. ` +
        `Ask a narrower question or have agy write large artifacts to workspace files. ` +
        `AGY_MAX_OUTPUT_CHARS controls returned text and does not raise this safety limit.`,
      model,
    );
    this.name = "OutputLimitError";
    this.finishedReason = "output_limit";
    this.usageKnown = false;
  }
}
