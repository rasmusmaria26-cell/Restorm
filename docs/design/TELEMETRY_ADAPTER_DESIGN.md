# Restorm — SAP Integration Telemetry Adapter Design Specification

**Project:** Retry Storm Sentinel (Restorm)  
**Location:** `C:\Users\lumaa\OneDrive\Desktop\projects\Restorm`  
**Document Version:** 1.0.0  
**Status:** Approved Design Specification  

---

## 1. Executive Summary

This document specifies the integration adapter contract for ingesting external SAP integration telemetry (such as from SAP Cloud Integration / CPI message monitoring APIs, SAP Process Orchestration, or enterprise event brokers) into **Restorm**. The design establishes a robust, versioned mapping layer that translates external message payloads into Restorm's internal queue snapshot schema while strictly enforcing input validation, clock skew defense, duplicate deduplication, and determinism.

---

## 2. Restorm Internal Telemetry Schema

Restorm's monitoring service (`MonitoringService.ingestTelemetry`) and persistence store (`QueueSnapshots`) expect a normalized snapshot structure:

| Field Name | Type | Constraints / Bounds | Description |
|---|---|---|---|
| `interfaceId` | UUID (`String(36)`) | Must reference active interface | Unique identifier of the monitored integration interface |
| `capturedAt` | ISO-8601 DateTime | Max 5 min future, max 7 days past | Timestamp when metrics were captured |
| `pendingCount` | Integer | `[0, 1,000,000]` | Number of messages currently queued / unprocessed |
| `failedCount` | Integer | `[0, 1,000,000]` | Number of messages in dead-letter or permanent error state |
| `retryAttempts` | Integer | `[0, 1,000,000]` | Cumulative retry attempts executed in current monitoring window |
| `successCount` | Integer | `[0, 1,000,000]` | Successfully processed message count |
| `oldestPendingAgeSeconds` | Integer | `[0, 2,592,000]` (30 days) | Age in seconds of the oldest unprocessed message at queue head |

---

## 3. Field Classification

| External Telemetry Field | Classification | Mapping Rule |
|---|---|---|
| Interface Identifier (`messageId`, `channelId`, `ifaceUuid`) | **Required** | Mapped via lookup table or direct UUID to Restorm `interface_ID` |
| Timestamp (`timestamp`, `eventTime`, `logDate`) | **Optional** (defaults to `now()`) | Validated ISO-8601 string; falls back to server current time if missing |
| Unprocessed / Queued Count (`processing`, `queued`, `backlog`) | **Required** | Directly mapped to `pendingCount` (integer bounds checked) |
| Error / DLQ Count (`error`, `failed`, `deadLetter`) | **Required** | Directly mapped to `failedCount` |
| Retry Count (`retries`, `retryCount`, `attemptCount`) | **Required** | Directly mapped to `retryAttempts` |
| Completed / Success Count (`completed`, `success`, `processed`) | **Required** | Directly mapped to `successCount` |
| Oldest Message Age (`oldestAgeSec`, `maxWaitTime`) | **Required** | Directly mapped to `oldestPendingAgeSeconds` |
| Payload Body / Message Content | **Unavailable / Excluded** | Excluded for privacy and performance; only aggregate metrics are ingested |

---

## 4. Versioned Adapter Interface (`v1`)

```javascript
/**
 * SAP Cloud Integration (CPI) v1 Telemetry Adapter
 * Transforms external raw monitoring payloads into Restorm ingestTelemetry payload format.
 */
function adaptCPITelemetry(externalPayload, interfaceUuidMapping) {
    if (!externalPayload || typeof externalPayload !== 'object') {
        throw new Error('Invalid external telemetry payload');
    }

    const sourceChannel = externalPayload.channelId || externalPayload.integrationFlowId;
    const mappedInterfaceId = interfaceUuidMapping[sourceChannel] || externalPayload.interfaceId;

    return {
        interfaceId: mappedInterfaceId,
        capturedAt: externalPayload.timestamp || new Date().toISOString(),
        pendingCount: Number.parseInt(externalPayload.metrics?.queued ?? externalPayload.pending ?? 0, 10),
        failedCount: Number.parseInt(externalPayload.metrics?.failed ?? externalPayload.failed ?? 0, 10),
        retryAttempts: Number.parseInt(externalPayload.metrics?.retries ?? externalPayload.retryAttempts ?? 0, 10),
        successCount: Number.parseInt(externalPayload.metrics?.success ?? externalPayload.successCount ?? 0, 10),
        oldestPendingAgeSeconds: Number.parseInt(externalPayload.metrics?.maxAgeSeconds ?? externalPayload.oldestPendingAgeSeconds ?? 0, 10)
    };
}
```

---

## 5. Validation & Error Handling

1. **Type Safety & Bounds:** All numeric fields are strictly verified to be integers (rejecting floats and strings) within `[0, 1,000,000]`.
2. **Clock Skew Defense:** Timestamps more than 5 minutes in the future or older than 7 days are rejected with HTTP 400.
3. **Existence Check:** Unknown or inactive interface UUIDs are rejected with HTTP 404 / 400.

---

## 6. Duplicate, Delayed, and Out-of-Order Handling

- **Duplicate Observations:** Ingesting identical metrics consecutively triggers Restorm's alert deduplication engine (`repeatCount` incremented, window extended, no duplicate alerts created).
- **Delayed / Out-of-Order Telemetry:** Snapshots are appended chronologically to `QueueSnapshots`. Rule D (Recovery Stalled) and trend evaluations rely on `ORDER BY capturedAt DESC` to correctly compare against the immediately preceding observation regardless of ingestion arrival order.
- **No Metric Fabrication:** Missing fields are never arbitrarily fabricated; missing required fields result in validation rejection.

---

## 7. Assumptions & Constraints

- No direct production SAP connection is established; payloads are ingested via secure OData V4 REST endpoints (`MonitoringService.ingestTelemetry`).
- External channel IDs are mapped to Restorm interface UUIDs via configuration mapping.
- Existing deterministic detection rules (`detectionEngine.js`) remain unchanged.
