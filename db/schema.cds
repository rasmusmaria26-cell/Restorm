namespace sap.retrysentinel;

using { cuid, managed } from '@sap/cds/common';

/**
 * 9.1 Monitored Interfaces / Integrations
 */
entity Interfaces : cuid, managed {
    name                      : String(100);
    sourceSystem              : String(50);
    targetSystem              : String(50);
    active                    : Boolean default true;
    expectedSchedule          : String(100);
    description               : String(255);
    // Configurable SLA & detection threshold policies (per interface)
    maxRetryThreshold         : Integer default 100; // Rule A: Excessive retries
    queueGrowthLimit          : Integer default 200; // Rule B: Backlog growth
    oldMessageAgeLimitSeconds : Integer default 600; // Rule C: Stale message age SLA (seconds)
    recoveryStalledBacklog    : Integer default 100; // Rule D: Stalled recovery backlog
    snapshots                 : Composition of many QueueSnapshots on snapshots.interface = $self;
    alerts           : Association to many Alerts on alerts.interface = $self;
}

/**
 * 9.2 Periodic Queue Metric Snapshots
 */
entity QueueSnapshots : cuid, managed {
    interface               : Association to Interfaces;
    capturedAt              : DateTime;
    pendingCount            : Integer;
    failedCount             : Integer;
    retryAttempts           : Integer;
    successCount            : Integer;
    oldestPendingAgeSeconds : Integer;
}

/**
 * 9.3 Generated Alerts
 */
entity Alerts : cuid, managed {
    interface       : Association to Interfaces;
    ruleCode        : String(50); // EXCESSIVE_RETRIES, QUEUE_GROWTH, OLD_MESSAGE_AGE, RECOVERY_STALLED
    severity        : String(20); // Info, Warning, High, Critical
    status          : String(20) default 'Open'; // Open, Acknowledged, Resolved, Closed
    repeatCount     : Integer default 1; // Number of times incident repeated in current window
    detectedAt      : DateTime;
    windowStart     : DateTime;
    windowEnd       : DateTime;
    observedMetrics : LargeString; // JSON payload with snapshot metrics & thresholds
    summary         : String(255);
    acknowledgedAt  : DateTime;
    acknowledgedBy  : String(100);
    resolvedAt      : DateTime;
    resolvedBy      : String(100);
    aiExplanation   : LargeString;
}

/**
 * 9.4 Curated Runbook Reference Entries
 */
entity RunbookEntries : cuid, managed {
    ruleCode    : String(50);
    title       : String(150);
    symptoms    : LargeString;
    checks      : LargeString;
    limitations : LargeString;
    keywords    : String(255);
}

/**
 * 9.5 Integration Systems & Landscape Nodes (Phase 4)
 */
entity Systems : cuid, managed {
    code        : String(50); // E.g. WEBSHOP, S4HANA, PAYGATE, WMS, CPI
    name        : String(100);
    category    : String(50); // Source, Target, Middleware, EventBroker
    environment : String(50) default 'Synthetic';
    tier        : String(20) default 'Core'; // Mission-Critical, Core, Supporting
}

/**
 * 9.6 Topology Connections / Channels (Phase 4)
 */
entity Connections : cuid, managed {
    interface       : Association to Interfaces;
    sourceSystem    : Association to Systems;
    targetSystem    : Association to Systems;
    component       : String(100); // E.g. "SAP Cloud Integration (CPI)", "Enterprise Event Mesh"
    protocol        : String(50);  // E.g. "HTTPS / OData V4", "REST / HTTPS", "AMQP"
    connectionType  : String(50);  // Asynchronous Queue, Asynchronous Batch, Event Stream
}

