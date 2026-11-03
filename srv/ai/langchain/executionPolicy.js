/**
 * Execution Policy and Bounds for LangChain Incident Agent
 *
 * Enforces strict operational boundaries to prevent infinite agent loops,
 * excessive resource consumption, and runaway API costs.
 */

const EXECUTION_POLICY = {
    // Maximum tool invocations permitted per investigation session
    MAX_TOOL_CALLS: 5,

    // Maximum reasoning/action iterations for the agent loop
    MAX_ITERATIONS: 4,

    // Per-tool execution timeout in milliseconds
    TOOL_TIMEOUT_MS: 5000,

    // LLM request timeout in milliseconds
    MODEL_TIMEOUT_MS: 12000,

    // Total end-to-end investigation deadline in milliseconds
    TOTAL_INVESTIGATION_TIMEOUT_MS: 20000,

    // Hard ceiling on historical telemetry records returned to context
    MAX_SNAPSHOTS_LIMIT: 20,

    // Hard ceiling on runbook citations
    MAX_RUNBOOK_RESULTS: 3,

    // Maximum length for raw strings passed to or from tools
    MAX_STRING_LENGTH: 2000
};

module.exports = {
    EXECUTION_POLICY
};
