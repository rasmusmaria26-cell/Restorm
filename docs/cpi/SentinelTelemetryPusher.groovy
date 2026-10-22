/*
 * =========================================================================================
 * SAP Cloud Integration (CPI) — Retry Storm Sentinel Telemetry Pusher
 * =========================================================================================
 *
 * Description:
 * Reusable Groovy script designed for SAP Integration Suite (Cloud Integration / CPI).
 * Runs inside an Exception Subprocess, JMS retry handler, or Looping Process Call to capture
 * integration backpressure, failed delivery attempts, and retry cascades, then pushes
 * standardized telemetry snapshots to Retry Storm Sentinel.
 *
 * Safety & Design Constraints:
 * 1. ZERO Third-Party Dependencies: Uses only Java SE 8/11/17 and standard Groovy 2.4+.
 * 2. Fail-Safe / Non-Blocking: Any network or parsing issue is logged to CPI Message
 *    Processing Log (MPL) without aborting or altering the original business message exchange.
 * 3. Strict Timeout: Max 3000ms HTTP timeout to prevent CPI worker thread starvation.
 * 4. Reusable in both Exception Subprocesses and Standard Monitoring steps.
 *
 * Author: Retry Storm Sentinel Team
 * License: Apache 2.0
 * =========================================================================================
 */

import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonBuilder
import groovy.json.JsonOutput
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant

/**
 * Main CPI entry point invoked by the Script Step in SAP Integration Suite.
 */
def Message processData(Message message) {
    def mpl = messageLogFactory?.getMessageLog(message)

    try {
        // ---------------------------------------------------------------------------------
        // 1. Extract Runtime Context from CPI Message Properties and Headers
        // ---------------------------------------------------------------------------------
        Map<String, Object> props = message.getProperties() ?: [:]
        Map<String, Object> headers = message.getHeaders() ?: [:]

        // Target Interface UUID in Retry Storm Sentinel
        // Configurable via iFlow Externalized Parameter (e.g. 'SENTINEL_INTERFACE_ID')
        String interfaceId = props.get("SENTINEL_INTERFACE_ID") ?: headers.get("SentinelInterfaceId") ?: "11111111-1111-1111-1111-111111111111"

        // Sentinel Service URL (e.g., https://<btp-app>.cfapps.eu10.hana.ondemand.com/odata/v4/monitoring/ingestTelemetry)
        String sentinelEndpoint = props.get("SENTINEL_ENDPOINT_URL") ?: headers.get("SentinelEndpointUrl") ?: "http://localhost:4004/odata/v4/monitoring/ingestTelemetry"

        // Authentication Header staged by CPI Security Material (Basic Auth or Bearer Token)
        String authHeader = props.get("SENTINEL_AUTH_HEADER") ?: headers.get("Authorization") ?: ""

        // Retry Counter: Extract from standard Camel / CPI loop index or custom header
        Integer retryCount = parseIntegerSafe(props.get("CamelLoopIndex") ?: headers.get("SAP_RetryCount") ?: headers.get("CamelRedeliveryCounter") ?: 1)

        // Error / Status codes
        Integer httpResponseCode = parseIntegerSafe(headers.get("CamelHttpResponseCode") ?: 500)
        Boolean isFailure = httpResponseCode >= 400 || props.get("CamelExceptionCaught") != null

        // Queue Backpressure estimation (from JMS headers or batch counters if available)
        Integer pendingCount = parseIntegerSafe(headers.get("SAP_JMS_QueueDepth") ?: props.get("PendingMessageCount") ?: (retryCount * 5))
        Integer failedCount = isFailure ? parseIntegerSafe(props.get("FailedBatchCount") ?: 1) : 0
        Integer successCount = isFailure ? 0 : 1

        // Age of oldest message in seconds
        Long creationTimestamp = parseLongSafe(headers.get("SAP_MessageCreatedTimestamp") ?: System.currentTimeMillis())
        Integer oldestPendingAgeSeconds = Math.max(0, (int) ((System.currentTimeMillis() - creationTimestamp) / 1000L))
        if (oldestPendingAgeSeconds == 0 && retryCount > 1) {
            oldestPendingAgeSeconds = retryCount * 30 // Estimated backoff age
        }

        // Current UTC ISO-8601 Timestamp
        String capturedAt = Instant.now().toString()

        // ---------------------------------------------------------------------------------
        // 2. Assemble Structured Ingestion Payload
        // ---------------------------------------------------------------------------------
        Map<String, Object> payloadMap = [
            interfaceId            : interfaceId,
            capturedAt             : capturedAt,
            pendingCount           : Math.min(pendingCount, 1000000),
            failedCount            : Math.min(failedCount, 1000000),
            retryAttempts          : Math.min(retryCount, 1000000),
            successCount           : Math.min(successCount, 1000000),
            oldestPendingAgeSeconds: Math.min(oldestPendingAgeSeconds, 2592000)
        ]

        String jsonPayload = JsonOutput.toJson(payloadMap)

        // ---------------------------------------------------------------------------------
        // 3. Execution Mode A: Stage Headers for CPI HTTP Receiver Adapter (Recommended)
        // ---------------------------------------------------------------------------------
        // Allows the iFlow to dispatch via a standard asynchronous Request-Reply / ProcessDirect step
        message.setHeader("Sentinel-Payload", jsonPayload)
        message.setProperty("SentinelTelemetryJson", jsonPayload)

        // ---------------------------------------------------------------------------------
        // 4. Execution Mode B: Direct Asynchronous HTTP Push (Fire-and-Forget)
        // ---------------------------------------------------------------------------------
        Boolean directPushEnabled = Boolean.parseBoolean(String.valueOf(props.get("SENTINEL_DIRECT_PUSH_ENABLED") ?: "false"))
        if (directPushEnabled && sentinelEndpoint) {
            pushTelemetryDirect(sentinelEndpoint, authHeader, jsonPayload, mpl)
        }

        if (mpl != null) {
            mpl.addCustomHeaderProperty("Sentinel_Status", "Staged")
            mpl.addCustomHeaderProperty("Sentinel_Retries", String.valueOf(retryCount))
        }

    } catch (Exception ex) {
        // NEVER fail the business message flow because of monitoring telemetry failures
        if (mpl != null) {
            mpl.addCustomHeaderProperty("Sentinel_Error", ex.getMessage()?.take(100) ?: "Unknown Error")
        }
    }

    return message
}

/**
 * Dispatches the JSON payload directly via HTTP with strict timeouts.
 */
private static void pushTelemetryDirect(String endpointUrl, String authHeader, String jsonBody, Object mpl) {
    HttpURLConnection conn = null
    try {
        URL url = new URL(endpointUrl)
        conn = (HttpURLConnection) url.openConnection()
        conn.setRequestMethod("POST")
        conn.setConnectTimeout(3000) // 3 seconds connect timeout
        conn.setReadTimeout(3000)    // 3 seconds read timeout
        conn.setDoOutput(true)
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("User-Agent", "SAP-Cloud-Integration-Sentinel-Adapter/1.0")

        if (authHeader && !authHeader.trim().isEmpty()) {
            conn.setRequestProperty("Authorization", authHeader.trim())
        }

        byte[] outputBytes = jsonBody.getBytes(StandardCharsets.UTF_8)
        conn.setFixedLengthStreamingMode(outputBytes.length)

        conn.getOutputStream().withStream { os ->
            os.write(outputBytes)
            os.flush()
        }

        int responseCode = conn.getResponseCode()
        if (mpl != null) {
            mpl.addCustomHeaderProperty("Sentinel_HTTP_Response", String.valueOf(responseCode))
        }
    } catch (Exception httpEx) {
        if (mpl != null) {
            mpl.addCustomHeaderProperty("Sentinel_HTTP_Exception", httpEx.getMessage()?.take(80) ?: "HTTP Fail")
        }
    } finally {
        if (conn != null) {
            try { conn.disconnect() } catch (Exception ignored) {}
        }
    }
}

private static Integer parseIntegerSafe(Object val) {
    if (val == null) return 0
    try {
        return Integer.parseInt(String.valueOf(val).trim())
    } catch (Exception e) {
        return 0
    }
}

private static Long parseLongSafe(Object val) {
    if (val == null) return 0L
    try {
        return Long.parseLong(String.valueOf(val).trim())
    } catch (Exception e) {
        return 0L
    }
}
