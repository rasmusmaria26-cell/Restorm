namespace sap.retrysentinel;

using { cuid, managed } from '@sap/cds/common';

/**
 * 9.1 Monitored Interfaces / Integrations
 */
entity Interfaces : cuid, managed {
    name             : String(100);
    sourceSystem     : String(50);
    targetSystem     : String(50);
    active           : Boolean default true;
    expectedSchedule : String(100);
    description      : String(255);
    snapshots        : Composition of many QueueSnapshots on snapshots.interface = $self;
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
