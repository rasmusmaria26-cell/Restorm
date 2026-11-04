using { MonitoringService } from './monitoring-service';

/**
 * annotations.cds — SAP Fiori Elements UI Annotations (Phase 5)
 *
 * Annotates the CAP OData V4 MonitoringService entities with SAP Fiori Elements
 * UI vocabularies (UI.HeaderInfo, UI.SelectionFields, UI.LineItem, UI.FieldGroup, UI.Facets).
 *
 * Powers the Fiori Elements List Report & Object Page applications.
 */

// =============================================================================
// Interfaces List Report & Object Page Annotations
// =============================================================================
annotate MonitoringService.Interfaces with @(
    UI.HeaderInfo : {
        TypeName       : 'Monitored Interface',
        TypeNamePlural : 'Monitored Interfaces',
        Title          : {
            $Type : 'UI.DataField',
            Value : name
        },
        Description    : {
            $Type : 'UI.DataField',
            Value : description
        }
    },
    UI.SelectionFields : [
        name,
        sourceSystem,
        targetSystem,
        active
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'Interface Name',
            Value : name
        },
        {
            $Type : 'UI.DataField',
            Label : 'Source System',
            Value : sourceSystem
        },
        {
            $Type : 'UI.DataField',
            Label : 'Target System',
            Value : targetSystem
        },
        {
            $Type : 'UI.DataField',
            Label : 'Active Status',
            Value : active
        },
        {
            $Type : 'UI.DataField',
            Label : 'Expected Schedule',
            Value : expectedSchedule
        },
        {
            $Type : 'UI.DataField',
            Label : 'Max Retry Threshold (Rule A)',
            Value : maxRetryThreshold
        },
        {
            $Type : 'UI.DataField',
            Label : 'Queue Growth Limit (Rule B)',
            Value : queueGrowthLimit
        },
        {
            $Type : 'UI.DataField',
            Label : 'Max Age SLA Sec (Rule C)',
            Value : oldMessageAgeLimitSeconds
        },
        {
            $Type : 'UI.DataField',
            Label : 'Stalled Drain Limit (Rule D)',
            Value : recoveryStalledBacklog
        }
    ],
    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'InterfaceDetailsFacet',
            Label  : 'General Configuration',
            Target : '@UI.FieldGroup#GeneralDetails'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ThresholdPoliciesFacet',
            Label  : 'Threshold & SLA Policies',
            Target : '@UI.FieldGroup#ThresholdDetails'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'SnapshotsFacet',
            Label  : 'Recent Queue Telemetry',
            Target : 'snapshots/@UI.LineItem'
        }
    ],
    UI.FieldGroup #GeneralDetails : {
        Data : [
            { $Type : 'UI.DataField', Label : 'Interface Name', Value : name },
            { $Type : 'UI.DataField', Label : 'Description', Value : description },
            { $Type : 'UI.DataField', Label : 'Source System', Value : sourceSystem },
            { $Type : 'UI.DataField', Label : 'Target System', Value : targetSystem },
            { $Type : 'UI.DataField', Label : 'Active', Value : active },
            { $Type : 'UI.DataField', Label : 'Expected Schedule', Value : expectedSchedule }
        ]
    },
    UI.FieldGroup #ThresholdDetails : {
        Data : [
            { $Type : 'UI.DataField', Label : 'Max Retry Threshold', Value : maxRetryThreshold },
            { $Type : 'UI.DataField', Label : 'Queue Growth Limit', Value : queueGrowthLimit },
            { $Type : 'UI.DataField', Label : 'Old Message Age Limit (Seconds)', Value : oldMessageAgeLimitSeconds },
            { $Type : 'UI.DataField', Label : 'Recovery Stalled Backlog', Value : recoveryStalledBacklog }
        ]
    }
);

// =============================================================================
// Alerts List Report Annotations
// =============================================================================
annotate MonitoringService.Alerts with @(
    UI.HeaderInfo : {
        TypeName       : 'Incident Alert',
        TypeNamePlural : 'Incident Alerts',
        Title          : {
            $Type : 'UI.DataField',
            Value : ruleCode
        },
        Description    : {
            $Type : 'UI.DataField',
            Value : summary
        }
    },
    UI.SelectionFields : [
        ruleCode,
        severity,
        status
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'Rule Code',
            Value : ruleCode
        },
        {
            $Type : 'UI.DataField',
            Label : 'Severity',
            Value : severity
        },
        {
            $Type : 'UI.DataField',
            Label : 'Lifecycle Status',
            Value : status
        },
        {
            $Type : 'UI.DataField',
            Label : 'Repeat Count',
            Value : repeatCount
        },
        {
            $Type : 'UI.DataField',
            Label : 'Detected At',
            Value : detectedAt
        },
        {
            $Type : 'UI.DataField',
            Label : 'Incident Summary',
            Value : summary
        }
    ]
);

// =============================================================================
// QueueSnapshots Table Annotations
// =============================================================================
annotate MonitoringService.QueueSnapshots with @(
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'Captured At',
            Value : capturedAt
        },
        {
            $Type : 'UI.DataField',
            Label : 'Pending Backlog',
            Value : pendingCount
        },
        {
            $Type : 'UI.DataField',
            Label : 'Cumulative Retries',
            Value : retryAttempts
        },
        {
            $Type : 'UI.DataField',
            Label : 'Throughput (msg/s)',
            Value : successCount
        },
        {
            $Type : 'UI.DataField',
            Label : 'Failed Count',
            Value : failedCount
        },
        {
            $Type : 'UI.DataField',
            Label : 'Oldest Age (Seconds)',
            Value : oldestPendingAgeSeconds
        }
    ]
);

